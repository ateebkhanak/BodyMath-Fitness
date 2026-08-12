const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

function toPublicUser(row) {
  return { id: row.id, fullName: row.full_name, email: row.email };
}

// ------------------------------------------------------------
// POST /api/auth/register
// Body: { fullName, email, password, confirmPassword }
// ------------------------------------------------------------
router.post('/register', async (req, res) => {
  const { fullName, email, password, confirmPassword } = req.body || {};

  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(fullName).trim().slice(0, 120);

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const info = db
      .prepare('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)')
      .run(normalizedName, normalizedEmail, passwordHash);

    const user = { id: info.lastInsertRowid, fullName: normalizedName, email: normalizedEmail };
    const token = signToken(user.id);
    return res.status(201).json({ token, user });
  } catch (e) {
    console.error('Registration failed:', e);
    return res.status(500).json({ error: 'Could not create your account — please try again.' });
  }
});

// ------------------------------------------------------------
// POST /api/auth/login
// Body: { email, password }
// ------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

  // Same error for "no such user" and "wrong password" — don't leak which
  // one it was, that would let someone enumerate registered emails.
  const genericError = { error: 'Invalid email or password.' };
  if (!row) return res.status(401).json(genericError);

  try {
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json(genericError);

    const token = signToken(row.id);
    return res.json({ token, user: toPublicUser(row) });
  } catch (e) {
    console.error('Login failed:', e);
    return res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
});

// ------------------------------------------------------------
// GET /api/auth/me  (requires auth)
// Used on page load to restore a session from a stored token —
// this is what makes "log in on another device, get your data back"
// work without asking for a password every time.
// ------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!row) return res.status(401).json({ error: 'Account no longer exists.' });
  return res.json({ user: toPublicUser(row) });
});

module.exports = router;
