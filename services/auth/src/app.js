const express = require('express');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const stripeRoutes = require('./routes/stripe');
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
const REQUIRED_ENV = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'];
const INSECURE_DEFAULTS = [
  'your-super-secret-jwt-key-change-in-production',
  'your-secret-key',
  'change-me',
  'change-this-refresh-secret'
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.NODE_ENV === 'production' && INSECURE_DEFAULTS.includes(process.env.JWT_SECRET)) {
  console.error(
    '[FATAL] JWT_SECRET is set to an insecure default. Set a real secret before running in production.'
  );
  process.exit(1);
}
if (
  process.env.NODE_ENV === 'production' &&
  INSECURE_DEFAULTS.includes(process.env.JWT_REFRESH_SECRET)
) {
  console.error(
    '[FATAL] JWT_REFRESH_SECRET is set to an insecure default. Set a real secret before running in production.'
  );
  process.exit(1);
}

const app = express();

// Stripe webhook requires raw body for signature verification.
app.post(
  '/api/v1/auth/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeRoutes.webhookHandler
);

// Body parsing middleware
app.use(express.json());
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
