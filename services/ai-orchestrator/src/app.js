const express = require('express');
const { authenticate } = require('@study-partner/shared/auth');
const {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  healthCheck
} = require('@study-partner/shared');
const aiRoutes = require('./routes/ai');

// --- Environment validation (fail-fast on missing secrets) ---
const REQUIRED_ENV = ['JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload middleware (for frame analysis proxy)
const fileUpload = require('express-fileupload');
app.use(fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));

// Shared middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Health check
app.get('/api/v1/health', healthCheck('ai-orchestrator'));

// Protected AI routes (require authentication)
app.use('/api/v1/ai', authenticate, aiRoutes);

// Log registered routes for debugging
console.log('[DEBUG] Registered routes:');
app._router.stack.forEach((middleware) => {
  if (middleware.route) {
    console.log(`  ${Object.keys(middleware.route.methods).join(', ').toUpperCase()} ${middleware.route.path}`);
  } else if (middleware.name === 'router') {
    console.log(`  Router mounted at: ${middleware.regexp}`);
    if (middleware.handle.stack) {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          console.log(`    ${Object.keys(handler.route.methods).join(', ').toUpperCase()} ${handler.route.path}`);
        }
      });
    }
  }
});

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
