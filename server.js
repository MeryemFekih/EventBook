// server.js — EventBook API (VULNERABLE VERSION)
// This file intentionally contains several vulnerabilities for a security
// audit exercise. Do NOT use this code in production.

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// VULN (bonus): hardcoded weak JWT secret
const JWT_SECRET = 'secret123';

// VULN (bonus - CORS misconfiguration): reflects any origin, allows credentials
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    // VULN (bonus - Information Disclosure)
    return res.status(401).json({ error: 'Invalid token', details: err.message, stack: err.stack });
  }
}

function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(userId, message);
}

// ---------- AUTH ----------
// VULN #3: SQL INJECTION via string concatenation.
// VULN #4 (weak auth): no rate limiting, 7-day tokens.
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  try {
    const user = db.prepare(query).get();
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password for user: ' + username });
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: '7d',
    });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Database error', details: err.message, stack: err.stack });
  }
});

// ---------- USERS ----------
// VULN #4a: MASS ASSIGNMENT — "role" trusted from the client body.
app.patch('/api/users/me', authMiddleware, (req, res) => {
  const fields = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const updated = {
    username: fields.username ?? user.username,
    password: fields.password ?? user.password,
    role: fields.role ?? user.role, // <-- privilege escalation
  };
  db.prepare('UPDATE users SET username = ?, password = ?, role = ? WHERE id = ?').run(
    updated.username,
    updated.password,
    updated.role,
    req.user.id
  );
  res.json({ message: 'Profile updated', user: updated });
});

// VULN (bonus - Broken Access Control): no role check at all.
app.get('/api/admin/users', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT id, username, password, role FROM users').all());
});

// ---------- EVENTS ----------
app.get('/api/events', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM events').all());
});

app.get('/api/events/:id', authMiddleware, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

app.post('/api/events', authMiddleware, (req, res) => {
  const { title, description, date, location, capacity } = req.body;
  const info = db
    .prepare('INSERT INTO events (owner_id, title, description, date, location, capacity) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, title, description, date, location, capacity);
  res.status(201).json({ id: info.lastInsertRowid });
});

// VULN #1: BROKEN ACCESS CONTROL / IDOR — no check that req.user owns the event.
// Any authenticated user can edit or delete ANY event.
app.patch('/api/events/:id', authMiddleware, (req, res) => {
  const { title, description, date, location, capacity } = req.body;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  db.prepare('UPDATE events SET title = ?, description = ?, date = ?, location = ?, capacity = ? WHERE id = ?').run(
    title ?? event.title,
    description ?? event.description,
    date ?? event.date,
    location ?? event.location,
    capacity ?? event.capacity,
    event.id
  );
  res.json({ message: 'Event updated' });
});

app.delete('/api/events/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ message: 'Event deleted' });
});

// VULN #3 (second instance): SQL Injection in search.
app.get('/api/events/search/query', authMiddleware, (req, res) => {
  const q = req.query.q || '';
  const query = `SELECT * FROM events WHERE title LIKE '%${q}%' OR location LIKE '%${q}%'`;
  try {
    res.json(db.prepare(query).all());
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ---------- RESERVATIONS ----------
// Visitor requests a place. VULN #2 seed point: "message" stored raw (stored XSS,
// rendered unsanitized on the owner's side — see public/app.js).
app.post('/api/events/:id/reservations', authMiddleware, (req, res) => {
  const { message } = req.body;
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const info = db
    .prepare('INSERT INTO reservations (event_id, user_id, message) VALUES (?, ?, ?)')
    .run(event.id, req.user.id, message || '');
  notify(event.owner_id, `${req.user.username} a demandé une place pour "${event.title}"`);
  res.status(201).json({ id: info.lastInsertRowid });
});

// My own reservation requests (as a visitor).
app.get('/api/reservations', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM reservations WHERE user_id = ?').all(req.user.id));
});

// VULN (bonus - Broken Access Control): meant to show reservations for events
// *you* own, but never filters by owner_id — any logged-in user sees every
// pending reservation for every event, including who requested what.
app.get('/api/owner/reservations', authMiddleware, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, e.title as event_title, e.owner_id
       FROM reservations r JOIN events e ON r.event_id = e.id`
    )
    .all();
  res.json(rows);
});

// VULN #1 (again) + VULN #4b (Mass Assignment): no check that req.user is the
// event owner, AND the requester themselves can set "status" directly,
// self-approving their own reservation.
app.patch('/api/reservations/:id', authMiddleware, (req, res) => {
  const { status } = req.body;
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(reservation.event_id);

  db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status ?? reservation.status, reservation.id);

  if (status === 'confirmed' || status === 'rejected') {
    notify(reservation.user_id, `Votre réservation pour "${event.title}" a été ${status === 'confirmed' ? 'confirmée' : 'refusée'}`);
  }
  res.json({ message: 'Reservation updated' });
});

app.delete('/api/reservations/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
  res.json({ message: 'Reservation deleted' });
});

// ---------- NOTIFICATIONS ----------
app.get('/api/notifications', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').all(req.user.id));
});

// VULN (bonus - IDOR): no ownership check — anyone can mark anyone else's
// notification as read, or fetch it by guessing the id via a modified client.
app.patch('/api/notifications/:id/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Marked as read' });
});

app.listen(PORT, () => {
  console.log(`EventBook (VULNERABLE) running on http://localhost:${PORT}`);
});
