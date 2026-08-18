const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'healthpilot.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ------------------------------------------------------------
// users — one row per registered account. Passwords are never stored in
// plain text; only a bcrypt hash is kept.
// ------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ------------------------------------------------------------
// user_data — a generic per-user JSON store. Every piece of app state
// (profile/plan snapshot, workout customization, progress log entries,
// measurements, AI recommendations, etc.) is saved here under a
// data_key string, scoped to user_id. One row per (user, key) pair —
// re-saving the same key overwrites it.
//
// ON DELETE CASCADE means deleting a user automatically wipes all of
// their data — no separate cleanup step needed.
// ------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data_key TEXT NOT NULL,
    data_value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, data_key)
  );
`);

// ------------------------------------------------------------
// Migration: add password-reset columns if this DB was created before
// the forgot-password feature existed. Safe to run on every startup —
// it checks first and only alters the table if a column is missing.
// ------------------------------------------------------------
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('reset_token_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN reset_token_hash TEXT');
}
if (!userColumns.includes('reset_token_expires')) {
  db.exec('ALTER TABLE users ADD COLUMN reset_token_expires INTEGER');
}

module.exports = db;
