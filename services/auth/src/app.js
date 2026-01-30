/**
 * Express Application
 * Auth Service
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { errorHandler, ApiError } = require('@study-partner/shared-utils');
const config = require('./config');
const { authRoutes, roleRoutes, userRoutes, healthRoutes } = require('./routes');

const app = express();

// ====================
// Security Middlewares
// ====================
app.use(helmet());
app.use(cors(config.cors));

// ====================
// Rate Limiting
// ====================
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    message: 'Too many requests, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ====================
// Body Parsing
// ====================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ====================
// Logging
// ====================
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// ====================
// Trust Proxy (for correct IP behind reverse proxy)
// ====================
app.set('trust proxy', 1);

// ====================
// Routes
// ====================
app.use('/health', healthRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/roles', roleRoutes);
app.use('/users', userRoutes);

// ====================
// 404 Handler
// ====================
app.use((req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`));
});

// ====================
// Error Handler
// ====================
app.use(errorHandler);

module.exports = app;
