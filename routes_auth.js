const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../utils/mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}

function toPublicUser(row) {
  return { id: row.id, fullName: row.full_name, email: row.email };
}

// SHA-256 hash of the raw reset token — we only ever store/compare the
// hash, so a leaked database alone can't be used to reset anyone's
// password (same principle as never storing plaintext passwords).
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
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
// POST /api/auth/forgot-password
// Body: { email }
// Always responds with the same generic message whether or not the email
// is registered — this prevents anyone from using this endpoint to check
// which emails have accounts.
// ------------------------------------------------------------
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const generic = { message: 'If an account exists for that email, a password reset link has been sent.' };

  if (!isValidEmail(email)) return res.json(generic);

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(normalizedEmail);

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = Date.now() + RESET_TOKEN_EXPIRY_MS;

    db.prepare('UPDATE users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?')
      .run(tokenHash, expiresAt, user.id);

    // FRONTEND_URL should be the page the reset link opens, e.g.
    // https://ateebkhanak.github.io/BodyMath-Fitness/ — app.js reads the
    // ?reset= param on load and shows the "set new password" form.
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/?reset=${rawToken}`;

    try {
      await sendPasswordResetEmail(user.email, resetUrl);
    } catch (e) {
      // Don't leak email-sending failures to the client either — just log
      // it server-side so it can be diagnosed.
      console.error('Failed to send password reset email:', e);
    }
  }

  return res.json(generic);
});

// ------------------------------------------------------------
// POST /api/auth/reset-password
// Body: { token, newPassword }
// ------------------------------------------------------------
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid reset token.' });
  }
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const tokenHash = hashToken(token);
  const user = db.prepare('SELECT * FROM users WHERE reset_token_hash = ?').get(tokenHash);

  if (!user || !user.reset_token_expires || Date.now() > user.reset_token_expires) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?')
      .run(passwordHash, user.id);

    return res.json({ message: 'Your password has been updated. You can now log in.' });
  } catch (e) {
    console.error('Reset password failed:', e);
    return res.status(500).json({ error: 'Could not reset your password — please try again.' });
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
