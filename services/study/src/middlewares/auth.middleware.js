/**
 * Auth Middleware - Study Service
 */
const jwt = require('jsonwebtoken');
const { ApiError } = require('@study-partner/shared-utils');
const config = require('../config');

const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw ApiError.unauthorized('Authorization header is required');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw ApiError.unauthorized('Invalid authorization format');
    }

    const payload = jwt.verify(token, config.jwt.secret);

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

module.exports = { authenticate };
