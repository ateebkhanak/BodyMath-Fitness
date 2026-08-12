const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Every route below requires a valid token, and every query is filtered by
// req.userId — so there's no code path in this file that can return or
// modify another user's data.
router.use(requireAuth);

const MAX_KEY_LENGTH = 120;
const MAX_VALUE_BYTES = 2 * 1024 * 1024; // 2MB per stored item is generous for JSON app state

function isValidKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH;
}

// GET /api/data/:key
router.get('/:key', (req, res) => {
  if (!isValidKey(req.params.key)) return res.status(400).json({ error: 'Invalid key.' });

  const row = db
    .prepare('SELECT data_value, updated_at FROM user_data WHERE user_id = ? AND data_key = ?')
    .get(req.userId, req.params.key);

  if (!row) return res.status(404).json({ error: 'Not found.' });
  return res.json({ key: req.params.key, value: row.data_value, updatedAt: row.updated_at });
});

// PUT /api/data/:key   Body: { value: "<JSON string>" }
router.put('/:key', (req, res) => {
  if (!isValidKey(req.params.key)) return res.status(400).json({ error: 'Invalid key.' });

  const { value } = req.body || {};
  if (typeof value !== 'string') return res.status(400).json({ error: 'value must be a JSON string.' });
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    return res.status(413).json({ error: 'Value too large.' });
  }

  db.prepare(
    `INSERT INTO user_data (user_id, data_key, data_value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, data_key)
     DO UPDATE SET data_value = excluded.data_value, updated_at = excluded.updated_at`
  ).run(req.userId, req.params.key, value);

  return res.json({ ok: true });
});

// DELETE /api/data/:key
router.delete('/:key', (req, res) => {
  if (!isValidKey(req.params.key)) return res.status(400).json({ error: 'Invalid key.' });

  db.prepare('DELETE FROM user_data WHERE user_id = ? AND data_key = ?').run(req.userId, req.params.key);
  return res.json({ ok: true });
});

// GET /api/data  — lists this user's stored keys (handy for debugging /
// future features; not currently called by app.js).
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT data_key, updated_at FROM user_data WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.userId);
  return res.json({ keys: rows.map(r => ({ key: r.data_key, updatedAt: r.updated_at })) });
});

module.exports = router;
