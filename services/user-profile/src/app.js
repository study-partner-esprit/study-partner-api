const express = require('express');
const profileRoutes = require('./routes/profile');
const availabilityRoutes = require('./routes/availability');
const gamificationRoutes = require('./routes/gamification');
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
const INSECURE_DEFAULTS = ['your-super-secret-jwt-key-change-in-production', 'your-secret-key', 'change-me'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.NODE_ENV === 'production' && INSECURE_DEFAULTS.includes(process.env.JWT_SECRET)) {
  console.error('[FATAL] JWT_SECRET is set to an insecure default. Set a real secret before running in production.');
  process.exit(1);
}

const app = express();

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static directory for uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Shared middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Health check
app.get('/api/v1/health', healthCheck('user-profile'));

// Protected profile routes (require authentication)
app.use('/api/v1/users/profile', authenticate, profileRoutes);

// Protected availability routes (require authentication)
app.use('/api/v1/users/availability', authenticate, availabilityRoutes);

// Protected gamification routes (require authentication)
app.use('/api/v1/users/gamification', authenticate, gamificationRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
