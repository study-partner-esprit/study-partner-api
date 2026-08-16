const express = require('express');
const focusRoutes = require('./routes/focus');
const {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  healthCheck,
  logger
} = require('@study-partner/shared');
const { authenticate } = require('@study-partner/shared/auth');

// --- Environment validation (fail-fast on missing secrets) ---
const REQUIRED_ENV = ['JWT_SECRET', 'MONGODB_URI'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
const INSECURE_DEFAULTS = [
  'your-super-secret-jwt-key-change-in-production',
  'your-secret-key',
  'change-me',
  'replace_with_a_strong_secret',
  'change-this-refresh-secret'
];
if (process.env.NODE_ENV === 'production' && INSECURE_DEFAULTS.includes(process.env.JWT_SECRET)) {
  logger.error(
    '[FATAL] JWT_SECRET is set to an insecure default. Set a real secret before running in production.'
  );
  process.exit(1);
}

const app = express();

// Body parsing middleware
app.use(express.json());
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
