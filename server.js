const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const { pool, ensureSchema } = require('./src/db');
const { hashPassword, verifyPassword, requireAuth, requireOfficer } = require('./src/auth');
const { getGuildData, SHEET_ID } = require('./src/sheet');

const app = express();
// Render (and the Cloudflare edge in front of it) terminates TLS and forwards
// plain HTTP internally, so without this Express thinks every request is
// insecure and silently refuses to set the "Secure" session cookie below —
// login appears to succeed but the session never sticks.
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  cookieSession({
    name: 'guild_session',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
);

// ---------------------------------------------------------------------
// Setup (first run — create the first officer account)
// ---------------------------------------------------------------------
app.get('/api/setup-status', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  res.json({ needsSetup: rows[0].n === 0 });
});

app.post('/api/setup', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return res.status(400).json({ error: 'already_initialized' });
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'invalid_input', message: 'Логин обязателен, пароль — минимум 6 символов.' });
  }
  const passwordHash = hashPassword(password);
  const result = await pool.query(
    'INSERT INTO users (username, password_hash, role, active) VALUES ($1,$2,\'officer\',true) RETURNING id, username, role',
    [username.trim(), passwordHash]
  );
  const user = result.rows[0];
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'invalid_input' });
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
  const user = rows[0];
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Неверный логин или пароль.' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ ok: true, user: { username: user.username, role: user.role } });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.session.username, role: req.session.role });
});

// ---------------------------------------------------------------------
// Guild data (live, server-side fetch from the Google Sheet)
// ---------------------------------------------------------------------
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const data = await getGuildData(req.query.force === '1');
    if (req.session.role !== 'officer') {
      // Treasury holds financial detail — officers only.
      data.Treasury = [];
    }
    res.json({ data, sheetId: SHEET_ID, isOfficer: req.session.role === 'officer' });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'sheet_unavailable', message: String(e.message || e) });
  }
});

// ---------------------------------------------------------------------
// User management (officers only)
// ---------------------------------------------------------------------
app.get('/api/users', requireAuth, requireOfficer, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, role, active, created_at FROM users ORDER BY created_at ASC'
  );
  res.json({ users: rows });
});

app.post('/api/users', requireAuth, requireOfficer, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'invalid_input', message: 'Логин обязателен, пароль — минимум 6 символов.' });
  }
  const finalRole = role === 'officer' ? 'officer' : 'member';
  try {
    const passwordHash = hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role, active) VALUES ($1,$2,$3,true) RETURNING id, username, role, active, created_at',
      [username.trim(), passwordHash, finalRole]
    );
    res.json({ ok: true, user: result.rows[0] });
  } catch (e) {
    if (String(e.message).includes('duplicate key')) {
      return res.status(409).json({ error: 'username_taken', message: 'Такой логин уже занят.' });
    }
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.patch('/api/users/:id', requireAuth, requireOfficer, async (req, res) => {
  const id = Number(req.params.id);
  const { role, active, password } = req.body || {};
  const sets = [];
  const vals = [];
  let i = 1;
  if (role === 'officer' || role === 'member') { sets.push(`role = $${i++}`); vals.push(role); }
  if (typeof active === 'boolean') { sets.push(`active = $${i++}`); vals.push(active); }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'invalid_input', message: 'Пароль — минимум 6 символов.' });
    sets.push(`password_hash = $${i++}`);
    vals.push(hashPassword(password));
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });
  vals.push(id);
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Static app (protected)
// ---------------------------------------------------------------------
app.use('/public-assets', express.static(path.join(__dirname, 'public', 'assets')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/setup.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin.html', requireAuth, requireOfficer, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
);
app.get('/app.js', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.js')));
app.get('/admin.js', requireAuth, requireOfficer, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'styles.css')));

const PORT = process.env.PORT || 3000;
ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Guild dashboard listening on :${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to initialize database schema', e);
    process.exit(1);
  });
