/**
 * Express Application - Study Service
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { errorHandler, ApiError } = require('@study-partner/shared-utils');
const config = require('./config');
const { subjectRoutes, sessionRoutes, taskRoutes, healthRoutes } = require('./routes');

const app = express();

// Security
app.use(helmet());
app.use(cors(config.cors));

// Rate limiting
app.use(
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: { success: false, message: 'Too many requests' }
  })
);

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
app.use('/subjects', subjectRoutes);
app.use('/sessions', sessionRoutes);
app.use('/tasks', taskRoutes);

// 404
app.use((req, res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`));
});

// Error handler
app.use(errorHandler);

module.exports = app;
