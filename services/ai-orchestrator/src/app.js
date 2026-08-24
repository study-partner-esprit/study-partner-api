const express = require('express');
const cookieParser = require('cookie-parser');
const { authenticate } = require('@study-partner/shared/auth');
const {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  logger
} = require('@study-partner/shared');
const aiRoutes = require('./routes/ai');
const jobsRoutes = require('./routes/jobs');

// --- Environment validation (fail-fast on missing secrets) ---
const REQUIRED_ENV = ['JWT_SECRET'];
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
app.set('trust proxy', 1);

// Body parsing middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// File upload middleware (for frame analysis proxy)
const fileUpload = require('express-fileupload');
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));

// Shared middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Health check (no DB check for ai-orchestrator)
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-orchestrator',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Stricter rate limit for expensive AI operations (10 req/min)
const aiRateLimiter = rateLimiter(10, 60000);
app.use('/api/v1/ai/ingest', aiRateLimiter);
app.use('/api/v1/ai/plan', aiRateLimiter);
app.use('/api/v1/ai/coach', aiRateLimiter);
app.use('/api/v1/ai/signals', aiRateLimiter);

// Protected AI routes (require authentication)
app.use('/api/v1/ai', authenticate, aiRoutes);

// Async AI job endpoints (F01): create/poll jobs instead of sync LLM waits
app.use('/api/v1/ai', authenticate, jobsRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
