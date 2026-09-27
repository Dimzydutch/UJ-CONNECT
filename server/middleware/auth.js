const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function getTokenFromRequest(req) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    return header.split(' ')[1];
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
}

function verifyToken(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'No authentication token provided.' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Any "pending" token (e.g. pending2fa) is only valid for
    // completing that specific challenge — it must never grant access to
    // normal protected routes.
    if (decoded.type) {
      return res.status(401).json({ success: false, message: 'Verification required before you can do that.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  next();
}

// Attaches req.user if a valid token is present, but does not block the request otherwise
function optionalAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    // ignore invalid token for optional auth
  }
  next();
}

module.exports = { verifyToken, requireAdmin, optionalAuth, JWT_SECRET };
