const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') === -1) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'not_authenticated' });
    return res.redirect('/login.html');
  }
  next();
}

function requireOfficer(req, res, next) {
  if (!req.session || req.session.role !== 'officer') {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'officers_only' });
    return res.status(403).send('Доступно только офицерам гильдии.');
  }
  next();
}

module.exports = { hashPassword, verifyPassword, requireAuth, requireOfficer };
