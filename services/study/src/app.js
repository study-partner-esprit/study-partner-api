const express = require('express');
const path = require('path');
const taskRoutes = require('./routes/tasks');
const topicRoutes = require('./routes/topics');
const sessionRoutes = require('./routes/sessions');
const subjectRoutes = require('./routes/subjects');
const courseRoutes = require('./routes/courses');
const planRoutes = require('./routes/plans');
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

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Shared middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Serve uploaded files (subject images) from the service's uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/v1/health', healthCheck('study'));

// Rate limit file upload endpoints (5 req/min)
const uploadLimiter = rateLimiter(5, 60000);
app.post('/api/v1/study/courses/:courseId/files', uploadLimiter);
app.post('/api/v1/study/subjects', uploadLimiter);

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
