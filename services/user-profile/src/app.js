/**
 * Express Application - User Profile Service
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { errorHandler, ApiError } = require('@study-partner/shared-utils');
const config = require('./config');
const { profileRoutes, preferencesRoutes, goalsRoutes, healthRoutes } = require('./routes');

const app = express();

// Security
app.use(helmet());
app.use(cors(config.cors));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, message: 'Too many requests' },
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// Trust proxy
app.set('trust proxy', 1);

// Routes
app.use('/health', healthRoutes);
app.use('/profile', profileRoutes);
app.use('/preferences', preferencesRoutes);
app.use('/goals', goalsRoutes);

// 404
app.use((req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`));
});

// Error handler
app.use(errorHandler);

module.exports = app;
