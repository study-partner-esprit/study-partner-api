const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const taskRoutes = require('./routes/tasks');
const topicRoutes = require('./routes/topics');
const sessionRoutes = require('./routes/sessions');
const subjectRoutes = require('./routes/subjects');
const courseRoutes = require('./routes/courses');
const planRoutes = require('./routes/plans');
const learningObjectiveRoutes = require('./routes/learningObjectives');
const competencyRoutes = require('./routes/competencies');
const coachRoutes = require('./routes/coach');
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
requireEnv(['JWT_SECRET', 'MONGODB_URI', 'INTERNAL_API_SECRET', 'RABBITMQ_URL'], {
  serviceName: 'study'
});

const app = express();

// Trust proxy so express-rate-limit can correctly parse X-Forwarded-For in Docker
app.set('trust proxy', 1);

// Body parsing middleware with size limits
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Shared middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Serve uploaded files (subject images) from the service's uploads directory
// SEC-11: dotfiles and directory listings are denied; content sniffing off.
app.use(
  '/uploads',
  express.static(path.join(__dirname, '../uploads'), {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
  })
);

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
app.use('/api/v1/study/learning-objectives', authenticate, learningObjectiveRoutes);
app.use('/api/v1/competencies', authenticate, competencyRoutes);
app.use('/api/v1/coach', authenticate, coachRoutes);
// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
