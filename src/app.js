const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const notFoundHandler = require('./middleware/notFoundHandler');

// Import routes
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const taskRoutes = require('./routes/task.routes');
const sessionRoutes = require('./routes/session.routes');

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) }
  }));
}

// API Routes
app.use('/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/sessions', sessionRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Study Partner API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      tasks: '/api/v1/tasks',
      sessions: '/api/v1/sessions'
    }
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
