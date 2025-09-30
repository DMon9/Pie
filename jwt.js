
const jwt = require('jsonwebtoken');
function signToken(user) {
  const payload = { id: user.id, email: user.email, role: user.role || 'user', name: user.name || 'User' };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}
function requireAdmin(req, res, next) {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
  if (req.user?.role === 'admin' || (req.user?.email || '').toLowerCase() === adminEmail) return next();
  return res.status(403).json({ error: 'Admin only' });
}
module.exports = { signToken, requireAuth, requireAdmin };
