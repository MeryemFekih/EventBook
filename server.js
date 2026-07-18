const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  })
);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function handleServerError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

function notify(userId, message) {
  db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)').run(userId, message);
}


app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const validPassword = user ? bcrypt.compareSync(password, user.password) : false;
    if (!user || !validPassword) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
      expiresIn: '1h', // FIX: short-lived token
    });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    handleServerError(res, err);
  }
});


app.patch('/api/users/me', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const allowedUpdates = { username: user.username, password: user.password };
    if (typeof req.body.username === 'string' && req.body.username.trim()) {
      allowedUpdates.username = req.body.username.trim();
    }
    if (typeof req.body.password === 'string' && req.body.password.length >= 6) {
      allowedUpdates.password = bcrypt.hashSync(req.body.password, 10);
    }
    db.prepare('UPDATE users SET username = ?, password = ? WHERE id = ?').run(
      allowedUpdates.username,
      allowedUpdates.password,
      req.user.id
    );
    res.json({ message: 'Profile updated', user: { username: allowedUpdates.username, role: user.role } });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  try {
    res.json(db.prepare('SELECT id, username, role FROM users').all());
  } catch (err) {
    handleServerError(res, err);
  }
});

app.patch('/api/admin/users/:id/role', authMiddleware, requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

app.get('/api/events', authMiddleware, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM events').all());
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/events/:id', authMiddleware, (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    handleServerError(res, err);
  }
});

app.post('/api/events', authMiddleware, (req, res) => {
  const { title, description, date, location, capacity } = req.body;
  if (!title || !description || !date || !location) {
    return res.status(400).json({ error: 'title, description, date and location are required' });
  }
  try {
    const info = db
      .prepare('INSERT INTO events (owner_id, title, description, date, location, capacity) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, title, escapeHtml(description), date, location, capacity || 10);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.patch('/api/events/:id', authMiddleware, (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the event owner can edit this event' });
    }
    const { title, description, date, location, capacity } = req.body;
    db.prepare('UPDATE events SET title = ?, description = ?, date = ?, location = ?, capacity = ? WHERE id = ?').run(
      title ?? event.title,
      description !== undefined ? escapeHtml(description) : event.description,
      date ?? event.date,
      location ?? event.location,
      capacity ?? event.capacity,
      event.id
    );
    res.json({ message: 'Event updated' });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.delete('/api/events/:id', authMiddleware, (req, res) => {
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the event owner can delete this event' });
    }
    db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    res.json({ message: 'Event deleted' });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/events/search/query', authMiddleware, (req, res) => {
  const q = req.query.q || '';
  try {
    const like = `%${q}%`;
    res.json(db.prepare('SELECT * FROM events WHERE title LIKE ? OR location LIKE ?').all(like, like));
  } catch (err) {
    handleServerError(res, err);
  }
});


app.post('/api/events/:id/reservations', authMiddleware, (req, res) => {
  const { message } = req.body;
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const info = db
      .prepare('INSERT INTO reservations (event_id, user_id, message) VALUES (?, ?, ?)')
      .run(event.id, req.user.id, escapeHtml(message || ''));
    notify(event.owner_id, `${req.user.username} a demandé une place pour "${event.title}"`);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/reservations', authMiddleware, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM reservations WHERE user_id = ?').all(req.user.id));
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/owner/reservations', authMiddleware, (req, res) => {
  try {
    const rows =
      req.user.role === 'admin'
        ? db.prepare(`SELECT r.*, e.title as event_title, e.owner_id FROM reservations r JOIN events e ON r.event_id = e.id`).all()
        : db
            .prepare(
              `SELECT r.*, e.title as event_title, e.owner_id
               FROM reservations r JOIN events e ON r.event_id = e.id
               WHERE e.owner_id = ?`
            )
            .all(req.user.id);
    res.json(rows);
  } catch (err) {
    handleServerError(res, err);
  }
});


app.patch('/api/reservations/:id', authMiddleware, (req, res) => {
  try {
    const { status } = req.body;
    if (!['confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(reservation.event_id);

    if (event.owner_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the event owner can respond to this reservation' });
    }

    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, reservation.id);
    notify(reservation.user_id, `Votre réservation pour "${event.title}" a été ${status === 'confirmed' ? 'confirmée' : 'refusée'}`);
    res.json({ message: 'Reservation updated' });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.delete('/api/reservations/:id', authMiddleware, (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(req.params.id);
    if (!reservation) return res.status(404).json({ error: 'Reservation not found' });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(reservation.event_id);
    const allowed = reservation.user_id === req.user.id || event.owner_id === req.user.id || req.user.role === 'admin';
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
    res.json({ message: 'Reservation deleted' });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').all(req.user.id));
  } catch (err) {
    handleServerError(res, err);
  }
});

app.patch('/api/notifications/:id/read', authMiddleware, (req, res) => {
  try {
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    if (notif.user_id !== req.user.id) return res.status(404).json({ error: 'Notification not found' });
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Marked as read' });
  } catch (err) {
    handleServerError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`EventBook (SECURE) running on http://localhost:${PORT}`);
});
