const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const stripeRoutes = require('./routes/stripe');
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
requireEnv(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'], { serviceName: 'auth' });

// Stripe keys must be provided together (billing enabled) or not at all.
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (Boolean(stripeSecretKey) !== Boolean(stripeWebhookSecret)) {
  console.error(
    '[auth][FATAL] STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together ' +
      '(or both omitted to disable billing).'
  );
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);

// Stripe webhook requires raw body for signature verification.
app.post(
  '/api/v1/auth/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeRoutes.webhookHandler
);

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
app.get('/api/v1/health', healthCheck('auth'));

// Auth routes (public) with stricter rate limits on auth endpoints
const authLimiter = rateLimiter(5, 60000); // 5 req/min for login
const registerLimiter = rateLimiter(3, 60000); // 3 req/min for register

app.post('/api/v1/auth/login', authLimiter);
app.post('/api/v1/auth/register', registerLimiter);
app.post('/api/v1/auth/forgot-password', rateLimiter(3, 60000));
app.post('/api/v1/auth/resend-verification', rateLimiter(3, 60000));
app.post('/api/v1/auth/verify-email', rateLimiter(10, 60000));
app.post('/api/v1/auth/verify-otp', rateLimiter(10, 60000));
app.post('/api/v1/auth/reset-password', rateLimiter(5, 60000));
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth/stripe', stripeRoutes.router);

// Admin routes (require authentication + admin role)
app.use('/api/v1/auth/admin', authenticate, adminRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
