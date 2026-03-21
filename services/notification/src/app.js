const express = require('express');
const notificationRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const voiceRoutes = require('./routes/voice');
const {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  healthCheck
} = require('@study-partner/shared');
const { authenticate } = require('@study-partner/shared/auth');

// --- Environment validation (fail-fast on missing secrets) ---
const REQUIRED_ENV = ['JWT_SECRET', 'MONGODB_URI'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

if (
  process.env.NODE_ENV === 'production' &&
  process.env.JWT_SECRET?.includes('change-in-production')
) {
  console.error('[FATAL] Insecure default JWT_SECRET detected in production');
  process.exit(1);
}

const app = express();

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Health check
app.get('/api/v1/health', healthCheck('notification'));

// Notification routes (require authentication)
app.use('/api/v1/notifications', authenticate, notificationRoutes);
app.use('/api/v1/session-chat', authenticate, chatRoutes);
app.use('/api/v1/voice', authenticate, voiceRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
