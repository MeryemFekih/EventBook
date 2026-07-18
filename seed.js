const bcrypt = require('bcryptjs');
const db = require('./db');

db.exec('DELETE FROM notifications; DELETE FROM reservations; DELETE FROM events; DELETE FROM users;');

const insertUser = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)');
insertUser.run('alice', bcrypt.hashSync('alice123', 10), 'user');
insertUser.run('bob', bcrypt.hashSync('bob123', 10), 'user');
insertUser.run('admin', bcrypt.hashSync('admin123', 10), 'admin');

const insertEvent = db.prepare(
  'INSERT INTO events (owner_id, title, description, date, location, capacity) VALUES (?, ?, ?, ?, ?, ?)'
);
insertEvent.run(1, 'Conférence Sécurité Web', 'Une conférence sur les vulnérabilités OWASP.', '2026-08-01', 'Paris', 50);
insertEvent.run(1, 'Atelier privé recrutement', 'Événement interne, candidats présélectionnés uniquement.', '2026-08-05', 'Lyon', 10);

const insertReservation = db.prepare(
  'INSERT INTO reservations (event_id, user_id, message, status) VALUES (?, ?, ?, ?)'
);
insertReservation.run(1, 2, 'Hâte d\'y assister !', 'pending');
insertReservation.run(2, 2, 'Je suis intéressé par ce poste.', 'pending');

console.log('Database seeded with test accounts (passwords hashed with bcrypt):');
console.log(' - alice / alice123 (user, owns 2 events)');
console.log(' - bob   / bob123   (user, visitor with 2 pending reservations)');
console.log(' - admin / admin123 (admin)');
