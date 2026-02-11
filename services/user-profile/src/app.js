const express = require('express');
// const {
//   corsMiddleware,
//   loggingMiddleware,
//   errorHandler,
//   rateLimiter,
//   healthCheck,
//   authenticate
// } = require('@study-partner/shared');
const profileRoutes = require('./routes/profile');

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
const healthCheck = (req, res) => res.json({ status: 'ok', service: 'user-profile' });

// Temporary JWT authentication until shared package is fixed
const jwt = require('jsonwebtoken');
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const app = express();

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static directory for uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Shared middleware
app.use(corsMiddleware);
app.use(loggingMiddleware);
app.use(rateLimiter);

// Health check
app.get('/api/v1/health', healthCheck);

// Protected profile routes (require authentication)
app.use('/api/v1/users/profile', authenticate, profileRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
