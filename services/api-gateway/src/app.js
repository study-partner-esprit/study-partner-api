const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
// const {
//   corsMiddleware,
//   loggingMiddleware,
//   errorHandler,
//   rateLimiter,
//   healthCheck,
//   logger
// } = require('@study-partner/shared');

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
const healthCheck = (req, res) => res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(loggingMiddleware);
app.use(rateLimiter);

// Health check
app.get('/api/v1/health', healthCheck);

// Service URLs from environment
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const USER_PROFILE_SERVICE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
const STUDY_SERVICE_URL = process.env.STUDY_SERVICE_URL || 'http://study-service:3003';
const AI_ORCHESTRATOR_SERVICE_URL = process.env.AI_ORCHESTRATOR_SERVICE_URL || 'http://ai-orchestrator-service:3004';
const SIGNAL_PROCESSING_SERVICE_URL = process.env.SIGNAL_PROCESSING_SERVICE_URL || 'http://signal-processing-service:3005';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006';

// Proxy configuration
const proxyOptions = {
  changeOrigin: true,
  xfwd: true,
  onError: (err, req, res) => {
    logger.error('Proxy error:', err);
    res.status(502).json({ error: 'Bad Gateway - Service unavailable' });
  },
  onProxyReq: (proxyReq, req) => {
    logger.debug(`Proxying ${req.method} ${req.path}`);
  }
};

// Route proxies
app.use('/api/v1/auth', createProxyMiddleware({ ...proxyOptions, target: AUTH_SERVICE_URL }));
app.use('/api/v1/users', createProxyMiddleware({ ...proxyOptions, target: USER_PROFILE_SERVICE_URL }));
app.use('/api/v1/study', createProxyMiddleware({ ...proxyOptions, target: STUDY_SERVICE_URL }));
app.use('/api/v1/ai', createProxyMiddleware({ ...proxyOptions, target: AI_ORCHESTRATOR_SERVICE_URL }));
app.use('/api/v1/signals', createProxyMiddleware({ ...proxyOptions, target: SIGNAL_PROCESSING_SERVICE_URL }));
app.use('/api/v1/analytics', createProxyMiddleware({ ...proxyOptions, target: ANALYTICS_SERVICE_URL }));

// Proxy for static uploads (Avatars) - Served by User Profile Service
// Note: In production, use Nginx or S3/Cloud storage directly
app.use('/uploads', createProxyMiddleware({ ...proxyOptions, target: USER_PROFILE_SERVICE_URL }));

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
