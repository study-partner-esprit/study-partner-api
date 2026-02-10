const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

/**
 * CORS middleware configuration
 */
function corsMiddleware() {
  return cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

/**
 * Request logging middleware
 */
function loggingMiddleware(req, res, next) {
  const requestId = uuidv4();
  req.requestId = requestId;

  const startTime = Date.now();

  logger.info(`[${requestId}] ${req.method} ${req.path} - Started`, {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
  });

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(
      `[${requestId}] ${req.method} ${req.path} - Completed ${res.statusCode} in ${duration}ms`,
      {
        requestId,
        statusCode: res.statusCode,
        duration,
      }
    );
  });

  next();
}

/**
 * Error handling middleware
 */
function errorHandler(err, req, res, next) {
  const requestId = req.requestId || 'unknown';

  logger.error(`[${requestId}] Error:`, {
    requestId,
    error: err.message,
    stack: err.stack,
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

/**
 * Rate limiting middleware
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs - Time window in milliseconds
 */
function rateLimiter(maxRequests = 100, windowMs = 60000) {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
}

/**
 * Health check endpoint handler
 */
function healthCheck(serviceName) {
  return (req, res) => {
    res.json({
      status: 'healthy',
      service: serviceName,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  };
}

module.exports = {
  corsMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  healthCheck,
};
