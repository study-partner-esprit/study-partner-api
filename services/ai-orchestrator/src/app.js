const express = require('express');
const { authenticate } = require('@study-partner/shared/auth');
// const {
//   corsMiddleware,
//   loggingMiddleware,
//   errorHandler,
//   rateLimiter,
//   healthCheck
// } = require('@study-partner/shared');
const aiRoutes = require('./routes/ai');

// Temporary middleware until shared package is fixed
const corsMiddleware = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
};

const loggingMiddleware = (req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - URL: ${req.url} - BaseURL: ${req.baseUrl}`);
  next();
};

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
};

const rateLimiter = (req, res, next) => next(); // No rate limiting for now
const healthCheck = (req, res) => res.json({ status: 'ok', service: 'ai-orchestrator' });

const app = express();

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Shared middleware
app.use(corsMiddleware);
app.use(loggingMiddleware);
app.use(rateLimiter);

// Health check
app.get('/api/v1/health', healthCheck);

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
