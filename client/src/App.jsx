import { useEffect, useState } from 'react';
import { api, saveToken, getToken, clearToken } from './api.js';

const NAV = [
  ['events', 'Événements'],
  ['mine', 'Mes réservations'],
  ['owner', 'Demandes reçues'],
  ['notifs', '🔔 Notifications'],
  ['admin', 'Admin'],
];

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('events');

  useEffect(() => {
    // if a token is already in localStorage (e.g. page refresh), we don't
    // re-derive the user from it here for simplicity — a fresh login is
    // required. This mirrors the original vanilla version.
  }, []);

  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <header>
        <h1>Event<span>Book</span></h1>
        <div className="session-pill">{user.username} · {user.role}</div>
      </header>
      <nav>
        {NAV.map(([id, label]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
        <button className="ghost" onClick={() => { clearToken(); setUser(null); }}>Logout</button>
      </nav>

      {view === 'events' && <Events user={user} />}
      {view === 'mine' && <MyReservations />}
      {view === 'owner' && <OwnerReservations />}
      {view === 'notifs' && <Notifications />}
      {view === 'admin' && <Admin />}
    </>
  );
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    saveToken(data.token);
    onLogin(data.user);
  }

  return (
    <div className="login-box">
      <h2>EventBook</h2>
      <form onSubmit={submit}>
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Login</button>
      </form>
      <p className="hint">Comptes: alice/alice123 (organisatrice), bob/bob123 (visiteur), admin/admin123</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Events({ user }) {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', date: '', location: '', capacity: 10 });

  async function load() {
    setEvents(await api('/api/events'));
  }
  useEffect(() => { load(); }, []);

  async function createEvent(e) {
    e.preventDefault();
    await api('/api/events', { method: 'POST', body: JSON.stringify(form) });
    setForm({ title: '', description: '', date: '', location: '', capacity: 10 });
    load();
  }

  async function open(id) {
    setSelected(await api('/api/events/' + id));
  }

  return (
    <>
      <div className="section-title">Créer un événement</div>
      <form className="card" onSubmit={createEvent}>
        <input placeholder="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input placeholder="Lieu" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <input type="number" placeholder="Capacité" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
        <button type="submit">Créer</button>
      </form>

      <div className="section-title">Tous les événements</div>
      {events.map((ev) => (
        <div className="card card-row" key={ev.id}>
          <div>
            <div className="card-title">#{ev.id} - {ev.title}</div>
            <div className="card-meta">{ev.date} @ {ev.location} · owner_id: {ev.owner_id}</div>
          </div>
          <button onClick={() => open(ev.id)}>Voir</button>
        </div>
      ))}

      {selected && <EventDetail event={selected} onChanged={() => { open(selected.id); load(); }} onClosed={() => setSelected(null)} />}
    </>
  );
}

function EventDetail({ event, onChanged, onClosed }) {
  const [message, setMessage] = useState('');

  async function editEvent() {
    const newTitle = prompt('Nouveau titre (démonstration IDOR : fonctionne même sans être propriétaire) :');
    if (!newTitle) return;
    await api('/api/events/' + event.id, { method: 'PATCH', body: JSON.stringify({ title: newTitle }) });
    onChanged();
  }

  async function deleteEvent() {
    await api('/api/events/' + event.id, { method: 'DELETE' });
    onClosed();
  }

  async function requestReservation() {
    await api(`/api/events/${event.id}/reservations`, { method: 'POST', body: JSON.stringify({ message }) });
    setMessage('');
    alert('Demande envoyée !');
  }

  return (
    <div className="card">
      <div className="card-title">#{event.id} - {event.title}</div>
      {/* VULN #2: STORED XSS SINK — the event description is rendered as raw
          HTML with dangerouslySetInnerHTML, with no sanitization. React
          normally auto-escapes text, so this vulnerability requires this
          explicit (and dangerous) opt-out, exactly as a real developer
          mistake would look like. */}
      <p dangerouslySetInnerHTML={{ __html: event.description }} />
      <p className="card-meta">{event.date} @ {event.location} - capacité: {event.capacity}</p>
      <button className="ghost" onClick={editEvent}>Modifier (test IDOR)</button>
      <button className="danger" onClick={deleteEvent}>Supprimer (test IDOR)</button>
      <textarea placeholder="Message pour l'organisateur..." value={message} onChange={(e) => setMessage(e.target.value)} />
      <button onClick={requestReservation}>Demander une place</button>
    </div>
  );
}

function MyReservations() {
  const [list, setList] = useState([]);
  async function load() { setList(await api('/api/reservations')); }
  useEffect(() => { load(); }, []);

  // Demonstrates the mass-assignment flaw: a visitor confirms their OWN request.
  async function selfConfirm(id) {
    await api('/api/reservations/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) });
    load();
  }

  return (
    <>
      <div className="section-title">Mes réservations</div>
      {list.map((r) => (
        <div className="card card-row" key={r.id}>
          <div>
            <div className="card-title">#{r.id} - événement #{r.event_id}</div>
            <span className={`badge ${r.status}`}>{r.status}</span>
          </div>
          <button onClick={() => selfConfirm(r.id)}>Auto-confirmer (test)</button>
        </div>
      ))}
    </>
  );
}

function OwnerReservations() {
  const [rows, setRows] = useState([]);
  async function load() { setRows(await api('/api/owner/reservations')); } // VULN: not filtered by owner
  useEffect(() => { load(); }, []);

  async function respond(id, status) {
    await api('/api/reservations/' + id, { method: 'PATCH', body: JSON.stringify({ status }) });
    load();
  }

  return (
    <>
      <div className="section-title">Demandes reçues (popup de validation)</div>
      {rows.map((r) => (
        <div className="comment" key={r.id}>
          <b>{r.event_title}</b> (owner_id: {r.owner_id}) — user #{r.user_id}:{' '}
          {/* VULN #2 (again): message rendered as raw HTML too. */}
          <span dangerouslySetInnerHTML={{ __html: r.message }} />{' '}
          <span className={`badge ${r.status}`}>{r.status}</span>
          <div>
            <button onClick={() => respond(r.id, 'confirmed')}>Accepter</button>
            <button className="ghost" onClick={() => respond(r.id, 'rejected')}>Refuser</button>
          </div>
        </div>
      ))}
    </>
  );
}

function Notifications() {
  const [list, setList] = useState([]);
  async function load() { setList(await api('/api/notifications')); }
  useEffect(() => { load(); }, []);

  async function markRead(id) {
    await api(`/api/notifications/${id}/read`, { method: 'PATCH' });
    load();
  }

  return (
    <>
      <div className="section-title">🔔 Notifications</div>
      {list.map((n) => (
        <div className="comment" key={n.id}>
          {!n.read && <b>[nouveau] </b>}
          {n.message}{' '}
          <button className="ghost" onClick={() => markRead(n.id)}>Marquer lu</button>
        </div>
      ))}
    </>
  );
}

function Admin() {
  const [users, setUsers] = useState(null);
  useEffect(() => { api('/api/admin/users').then(setUsers); }, []);

  return (
    <>
      <div className="section-title">Utilisateurs (admin)</div>
      {Array.isArray(users) ? (
        users.map((u) => (
          <div className="card" key={u.id}>
            #{u.id} {u.username} - role: {u.role} - password: {u.password}
          </div>
        ))
      ) : (
        <p className="error">{users?.error}</p>
      )}
    </>
  );
}
