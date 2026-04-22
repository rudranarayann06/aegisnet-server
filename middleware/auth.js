const { getAdmin } = require('../config/firebase');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const admin = getAdmin();
    if (!admin) {
      // Dev mode without Firebase — extract mock user from token
      req.user = { uid: 'dev-user', role: 'admin', email: 'dev@aegisnet.ai' };
      return next();
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      role: decoded.role || 'citizen',
    };
    next();
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      // Allow bypass in dev
      req.user = { uid: 'dev-user', role: 'admin', email: 'dev@aegisnet.ai' };
      return next();
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
