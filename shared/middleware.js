const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Security headers middleware (helmet)
 */
function securityMiddleware() {
  return helmet({
    contentSecurityPolicy: false, // Disabled for API-only services
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });
}

/**
 * CORS middleware configuration
 */
function corsMiddleware() {
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:5173', 'http://localhost:3000'];

  return cors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true, // allow all in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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
    ip: req.ip
  });

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(
      `[${requestId}] ${req.method} ${req.path} - Completed ${res.statusCode} in ${duration}ms`,
      {
        requestId,
        statusCode: res.statusCode,
        duration
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
    stack: err.stack
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    requestId,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
}

/**
 * Rate limiting middleware — Redis-backed when REDIS_URL is set, falls back to
 * in-memory otherwise. Keys by authenticated userId when available, otherwise IP.
 * @param {number} maxRequests - Maximum requests per window
 * @param {number} windowMs   - Time window in milliseconds
 */
let _redisStore = null;
let _redisStoreAttempted = false;

function _getRedisStore() {
  if (_redisStoreAttempted) return _redisStore || null;
  _redisStoreAttempted = true;

  const REDIS_URL = process.env.REDIS_URL;
  if (!REDIS_URL) return null;

  try {
    const Redis = require('ioredis');
    const RedisStore = require('rate-limit-redis');
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      enableReadyCheck: true
    });

    client.on('error', () => {
      _redisStore = null;
    });

    _redisStore = new RedisStore({
      sendCommand: (...args) => client.call(...args),
      prefix: 'rl:'
    });

    return _redisStore;
  } catch {
    return null;
  }
}

function rateLimiter(maxRequests = 100, windowMs = 60000) {
  const store = _getRedisStore();
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user && req.user.userId) || req.ip,
    ...(store ? { store } : {})
  });
}

/**
 * Health check endpoint handler with readiness probe
 */
function healthCheck(serviceName) {
  return async (req, res) => {
    const health = {
      status: 'healthy',
      service: serviceName,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };

    // Check MongoDB connection if mongoose is loaded
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        health.status = 'degraded';
        health.db = 'disconnected';
      } else {
        health.db = 'connected';
      }
    } catch {
      // No mongoose in this service (e.g., api-gateway)
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  };
}

/**
 * Wrap an async Express route handler so thrown errors are forwarded to
 * the Express error handler instead of becoming unhandled promise rejections.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  healthCheck,
  asyncHandler
};
