/**
 * Authentication Middleware
 * Validates JWT tokens and attaches user to request
 */
const { verifyAccessToken } = require('../utils/jwt');
const { ApiError } = require('@study-partner/shared-utils');

/**
 * Authenticate request using JWT
 */
const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw ApiError.unauthorized('Authorization header is required');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Invalid authorization format. Use: Bearer <token>');
    }

    const payload = verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      sub: payload.sub,
      email: payload.email,
      roles: payload.roles || []
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      next(ApiError.unauthorized('Token has expired'));
    } else if (error.name === 'JsonWebTokenError') {
      next(ApiError.unauthorized('Invalid token'));
    } else {
      next(error);
    }
  }
};

/**
 * Optional authentication - continues if no token provided
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return next();
  }

  authenticate(req, res, next);
};

module.exports = {
  authenticate,
  optionalAuth
};
