const express = require('express');
const cookieParser = require('cookie-parser');
const focusRoutes = require('./routes/focus');
const {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  healthCheck,
  requireEnv
} = require('@study-partner/shared');
const { authenticate } = require('@study-partner/shared/auth');

// --- Environment validation (fail-fast on missing secrets) ---
requireEnv(['JWT_SECRET', 'MONGODB_URI', 'INTERNAL_API_SECRET'], {
  serviceName: 'signal-processing'
});

const app = express();
app.set('trust proxy', 1);

// Body parsing middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Shared middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Health check
app.get('/api/v1/health', healthCheck('signal-processing'));

// Protected signal processing routes (require authentication)
app.use('/api/v1/signals/focus', authenticate, focusRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
