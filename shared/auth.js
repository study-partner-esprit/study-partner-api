const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const UserRole = {
  STUDENT: 'student',
  ADMIN: 'admin'
};

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

/**
 * Hash a password using bcrypt
 * @param {string} password
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

/**
 * Verify a password against a hash
 * @param {string} password
 * @param {string} hashedPassword
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, hashedPassword) {
  return bcrypt.compare(password, hashedPassword);
}

/**
 * Generate a JWT access token
 * @param {Object} payload - { userId, email, role }
 * @returns {string}
 */
function generateToken(payload) {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN
  });
}

/**
 * Verify and decode a JWT token
 * @param {string} token
 * @returns {Object}
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

/**
 * Middleware to authenticate requests using JWT
 */
function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware to require a specific role
 * @param {string} role
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role !== role) {
      return res.status(403).json({
        error: `Insufficient permissions. Required role: ${role}`
      });
    }

    next();
  };
}

/**
 * Middleware to restrict an endpoint to admins or internal service-to-service
 * calls. Internal callers must present the shared INTERNAL_API_SECRET via the
 * `x-internal-secret` header. A normal (non-admin) user JWT alone is rejected.
 * Fails closed: if INTERNAL_API_SECRET is not configured, only admins pass.
 */
function requireInternalOrAdmin(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.isAdmin === true)) {
    return next();
  }

  const expectedSecret = process.env.INTERNAL_API_SECRET;
  const providedSecret = req.headers['x-internal-secret'];
  if (expectedSecret && providedSecret && providedSecret === expectedSecret) {
    return next();
  }

  return res.status(403).json({ error: 'Forbidden: admin or internal access required' });
}

module.exports = {
  UserRole,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authenticate,
  requireRole,
  requireInternalOrAdmin
};
