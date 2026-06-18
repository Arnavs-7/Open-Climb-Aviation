const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function verifyToken(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.',
      errors: []
    });
  }

  const token = header.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Token has expired. Please log in again.'
      : 'Invalid token. Please log in again.';
    return res.status(401).json({ success: false, message, errors: [] });
  }

  // Fetch fresh user from DB so req.user is always current
  const { data: user, error } = await supabase
    .from('users')
    .select('id, name, email, whatsapp, age, role, created_at, email_verified')
    .eq('id', decoded.userId)
    .single();

  if (error || !user) {
    return res.status(401).json({
      success: false,
      message: 'User account not found. Please log in again.',
      errors: []
    });
  }

  req.user = user;
  next();
}

// Standalone role check — must come AFTER verifyToken in the middleware chain
function verifyAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Admin access required.',
      errors: []
    });
  }
  next();
}

// Combined convenience alias for routes that use a single middleware
function requireAdmin(req, res, next) {
  verifyToken(req, res, () => verifyAdmin(req, res, next));
}

module.exports = { verifyToken, verifyAdmin, requireAdmin };
