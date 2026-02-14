const express = require('express');
// const {
//   corsMiddleware,
//   loggingMiddleware,
//   errorHandler,
//   rateLimiter,
//   healthCheck,
//   authenticate
// } = require('@study-partner/shared');
const path = require('path');
const taskRoutes = require('./routes/tasks');
const topicRoutes = require('./routes/topics');
const sessionRoutes = require('./routes/sessions');
const subjectRoutes = require('./routes/subjects');
const courseRoutes = require('./routes/courses');
const planRoutes = require('./routes/plans');

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
const healthCheck = (req, res) => res.json({ status: 'ok', service: 'study' });

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

// Shared middleware
app.use(corsMiddleware);
app.use(loggingMiddleware);
app.use(rateLimiter);

// Serve uploaded files (subject images) from the service's uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/v1/health', healthCheck);

// Protected study routes (require authentication)
app.use('/api/v1/study/tasks', authenticate, taskRoutes);
app.use('/api/v1/study/topics', authenticate, topicRoutes);
app.use('/api/v1/study/sessions', authenticate, sessionRoutes);
app.use('/api/v1/study/subjects', authenticate, subjectRoutes);
app.use('/api/v1/study/courses', authenticate, courseRoutes);
app.use('/api/v1/study/plans', authenticate, planRoutes);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
