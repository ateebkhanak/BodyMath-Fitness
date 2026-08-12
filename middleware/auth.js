const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly at startup rather than silently signing tokens with an
  // empty/predictable secret — that would let anyone forge a login.
  throw new Error('JWT_SECRET is not set. Copy server/.env.example to server/.env and fill it in.');
}

const TOKEN_EXPIRY = '30d';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Express middleware: requires a valid "Authorization: Bearer <token>"
// header, verifies it, and attaches the decoded user id to req.userId.
// Every data route is scoped by this id, so one user can never read or
// write another user's rows.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session — please log in again.' });
  }
}

module.exports = { requireAuth, signToken, JWT_SECRET };
