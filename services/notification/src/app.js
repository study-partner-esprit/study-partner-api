const express = require('express');
const cookieParser = require('cookie-parser');
const notificationRoutes = require('./routes/notifications');
const chatRoutes = require('./routes/chat');
const voiceRoutes = require('./routes/voice');
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
  serviceName: 'notification'
});

const app = express();
app.set('trust proxy', 1);

// Body parsing
app.use(express.json());
app.use(cookieParser());
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
