const express = require('express');
// const {
//   corsMiddleware,
//   loggingMiddleware,
//   errorHandler,
//   rateLimiter,
//   healthCheck,
//   authenticate
// } = require('@study-partner/shared');
const authRoutes = require('./routes/auth');

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
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
};

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
};

const rateLimiter = (req, res, next) => next(); // No rate limiting for now
const healthCheck = (req, res) => res.json({ status: 'ok', service: 'auth' });
const authenticate = (req, res, next) => next(); // No auth for now

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

// Auth routes (public)
app.use('/api/v1/auth', authRoutes);

// Protected /me endpoint requires authentication
app.get('/api/v1/auth/me', authenticate, authRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
