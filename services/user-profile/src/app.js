const express = require('express');
const cookieParser = require('cookie-parser');
const profileRoutes = require('./routes/profile');
const availabilityRoutes = require('./routes/availability');
const gamificationRoutes = require('./routes/gamification');
const rankingRoutes = require('./routes/ranking');
const questRoutes = require('./routes/quests');
const friendRoutes = require('./routes/friends');
const characterRoutes = require('./character/routes');
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
  serviceName: 'user-profile'
});

const app = express();

// Trust only one proxy hop (api-gateway) to keep rate-limit IP checks safe.
app.set('trust proxy', 1);

// Body parsing middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Serve static directory for uploads
// SEC-11: dotfiles and directory listings denied; content sniffing off.
const path = require('path');
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
  })
);

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

// Protected ranking routes (require authentication)
app.use('/api/v1/users/gamification/rank', authenticate, rankingRoutes);

// Protected quest routes (require authentication)
app.use('/api/v1/users/quests', authenticate, questRoutes);

// Protected friend routes (require authentication)
app.use('/api/v1/users/friends', authenticate, friendRoutes);

// Character routes are hosted in user-profile to keep user progression state cohesive.
app.use('/api/v1', characterRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
