const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const {
  corsMiddleware,
  securityMiddleware,
  loggingMiddleware,
  errorHandler,
  rateLimiter,
  logger
} = require('@study-partner/shared');

const app = express();

// Middleware
app.use(securityMiddleware());
app.use(corsMiddleware());
app.use(loggingMiddleware);
app.use(rateLimiter());

// Health check (no DB check for api-gateway)
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Study Partner API',
    version: '1.0.0',
    description: 'Gateway-level API reference for public service routes.'
  },
  servers: [{ url: '/' }],
  paths: {
    '/api/v1/health': { get: { summary: 'Gateway health check' } },
    '/api/v1/auth/login': { post: { summary: 'Authenticate user' } },
    '/api/v1/study/tasks': { get: { summary: 'List tasks' }, post: { summary: 'Create task' } },
    '/api/v1/ai/plan/create': { post: { summary: 'Create AI-powered study plan' } },
    '/api/v1/ai/coach': { post: { summary: 'Get coach decision' } },
    '/api/v1/ai/evaluator/session': { post: { summary: 'Evaluate completed session' } },
    '/api/v1/analytics/summary': { get: { summary: 'Get analytics summary' } },
    '/api/v1/notifications': {
      get: { summary: 'List notifications' },
      post: { summary: 'Create notification' }
    }
  }
};

app.get('/api/v1/docs/openapi.json', (req, res) => {
  res.json(OPENAPI_SPEC);
});

app.get('/api/v1/docs', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Study Partner API Docs</title>
        <style>
          body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
          .wrap { max-width: 920px; margin: 40px auto; padding: 0 20px; }
          .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 20px; }
          a { color: #38bdf8; }
          code { background: #1f2937; padding: 2px 6px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1>Study Partner API Docs</h1>
          <div class="card">
            <p>OpenAPI spec:</p>
            <p><a href="/api/v1/docs/openapi.json">/api/v1/docs/openapi.json</a></p>
            <p>Quick health check:</p>
            <p><code>GET /api/v1/health</code></p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Service URLs from environment
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
const USER_PROFILE_SERVICE_URL =
  process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
const STUDY_SERVICE_URL = process.env.STUDY_SERVICE_URL || 'http://study-service:3003';
const AI_ORCHESTRATOR_SERVICE_URL =
  process.env.AI_ORCHESTRATOR_SERVICE_URL || 'http://ai-orchestrator-service:3004';
const SIGNAL_PROCESSING_SERVICE_URL =
  process.env.SIGNAL_PROCESSING_SERVICE_URL || 'http://signal-processing-service:3005';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006';
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007';

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
app.use(
  '/api/v1/auth',
  createProxyMiddleware({
    ...proxyOptions,
    target: AUTH_SERVICE_URL,
    pathRewrite: { '^/api/v1/auth': '/api/v1/auth' }
  })
);
app.use(
  '/api/v1/users',
  createProxyMiddleware({
    ...proxyOptions,
    target: USER_PROFILE_SERVICE_URL,
    pathRewrite: { '^/api/v1/users': '/api/v1/users' }
  })
);
app.use(
  '/api/v1/study',
  createProxyMiddleware({
    ...proxyOptions,
    target: STUDY_SERVICE_URL,
    pathRewrite: { '^/api/v1/study': '/api/v1/study' }
  })
);
app.use(
  '/api/v1/ai',
  createProxyMiddleware({
    ...proxyOptions,
    target: AI_ORCHESTRATOR_SERVICE_URL,
    pathRewrite: { '^/api/v1/ai': '/api/v1/ai' },
    proxyTimeout: 300000,
    timeout: 300000
  })
);
app.use(
  '/api/v1/signals',
  createProxyMiddleware({
    ...proxyOptions,
    target: SIGNAL_PROCESSING_SERVICE_URL,
    pathRewrite: { '^/api/v1/signals': '/api/v1/signals' }
  })
);
app.use(
  '/api/v1/analytics',
  createProxyMiddleware({
    ...proxyOptions,
    target: ANALYTICS_SERVICE_URL,
    pathRewrite: { '^/api/v1/analytics': '/api/v1/analytics' },
    proxyTimeout: 60000,
    timeout: 60000
  })
);
app.use(
  '/api/v1/notifications',
  createProxyMiddleware({
    ...proxyOptions,
    target: NOTIFICATION_SERVICE_URL,
    pathRewrite: { '^/api/v1/notifications': '/api/v1/notifications' },
    ws: true,
    proxyTimeout: 15000,
    timeout: 15000
  })
);
app.use(
  '/api/v1/session-chat',
  createProxyMiddleware({
    ...proxyOptions,
    target: NOTIFICATION_SERVICE_URL,
    pathRewrite: { '^/api/v1/session-chat': '/api/v1/session-chat' },
    proxyTimeout: 15000,
    timeout: 15000
  })
);
app.use(
  '/api/v1/voice',
  createProxyMiddleware({
    ...proxyOptions,
    target: NOTIFICATION_SERVICE_URL,
    pathRewrite: { '^/api/v1/voice': '/api/v1/voice' },
    proxyTimeout: 15000,
    timeout: 15000
  })
);

// Proxy for static uploads (Avatars) - Served by User Profile Service
// Note: In production, use Nginx or S3/Cloud storage directly
app.use('/uploads', createProxyMiddleware({ ...proxyOptions, target: USER_PROFILE_SERVICE_URL }));

// ==================== Monitoring & Observability ====================

const axios = require('axios');
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://study-partner-ai:8000';

// Aggregate health check – pings every downstream service
app.get('/api/v1/monitoring/health', async (req, res) => {
  const services = {
    'api-gateway': { url: null, status: 'healthy' }, // self
    auth: { url: AUTH_SERVICE_URL },
    'user-profile': { url: USER_PROFILE_SERVICE_URL },
    study: { url: STUDY_SERVICE_URL },
    'ai-orchestrator': { url: AI_ORCHESTRATOR_SERVICE_URL },
    'signal-processing': { url: SIGNAL_PROCESSING_SERVICE_URL },
    analytics: { url: ANALYTICS_SERVICE_URL },
    notification: { url: NOTIFICATION_SERVICE_URL },
    'ai-service-python': { url: AI_SERVICE_URL }
  };

  const results = {};
  let allHealthy = true;

  await Promise.allSettled(
    Object.entries(services).map(async ([name, svc]) => {
      if (!svc.url) {
        results[name] = { status: 'healthy', latency: 0 };
        return;
      }
      const healthPath = name === 'ai-service-python' ? '/health' : '/api/v1/health';
      const start = Date.now();
      try {
        const r = await axios.get(`${svc.url}${healthPath}`, { timeout: 5000 });
        results[name] = { status: 'healthy', latency: Date.now() - start, data: r.data };
      } catch (err) {
        allHealthy = false;
        results[name] = { status: 'unhealthy', latency: Date.now() - start, error: err.message };
      }
    })
  );

  res.status(allHealthy ? 200 : 207).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: results
  });
});

// Request metrics (simple in-memory counters)
const metrics = { requests: 0, errors: 0, startTime: Date.now() };
app.use((req, res, next) => {
  metrics.requests++;
  res.on('finish', () => {
    if (res.statusCode >= 500) metrics.errors++;
  });
  next();
});

app.get('/api/v1/monitoring/metrics', (req, res) => {
  res.json({
    uptime_seconds: Math.floor((Date.now() - metrics.startTime) / 1000),
    total_requests: metrics.requests,
    total_errors: metrics.errors,
    error_rate:
      metrics.requests > 0 ? ((metrics.errors / metrics.requests) * 100).toFixed(2) + '%' : '0%',
    timestamp: new Date().toISOString()
  });
});

// Catch-all for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

module.exports = app;
