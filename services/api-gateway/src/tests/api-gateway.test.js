const request = require('supertest');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Mock logger
jest.mock('@study-partner/shared', () => ({
  corsMiddleware: jest.fn(() => (req, res, _next) => _next()),
  securityMiddleware: jest.fn(() => (req, res, _next) => _next()),
  loggingMiddleware: jest.fn((req, res, _next) => _next()),
  errorHandler: jest.fn((err, req, res) => {
    res.status(err.status || 500).json({ error: err.message });
  }),
  rateLimiter: jest.fn(() => (req, res, _next) => _next()),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('API Gateway', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock endpoints
    app.get('/api/v1/health', (req, res) => {
      res.json({ status: 'healthy', service: 'api-gateway' });
    });

    // Mock service proxies
    app.use(
      '/api/v1/auth',
      createProxyMiddleware({
        target: 'http://localhost:3001',
        changeOrigin: true,
        pathRewrite: { '^/api/v1/auth': 'http://auth-service:3003' }
      })
    );

    app.use(
      '/api/v1/study',
      createProxyMiddleware({
        target: 'http://localhost:3001',
        changeOrigin: true,
        pathRewrite: { '^/api/v1/study': 'http://study-service:3004' }
      })
    );

    app.use(
      '/api/v1/users',
      createProxyMiddleware({
        target: 'http://localhost:3001',
        changeOrigin: true,
        pathRewrite: { '^/api/v1/users': 'http://user-profile-service:3002' }
      })
    );
  });

  describe('Health Check', () => {
    test('should return healthy status', async () => {
      const res = await request(app).get('/api/v1/health').expect(200);

      expect(res.body).toEqual({
        status: 'healthy',
        service: 'api-gateway'
      });
    });
  });

  describe('Routes', () => {
    test('should have /api/v1/auth route', async () => {
      expect(
        app._router.stack.some(
          (layer) => layer.name === 'middleware' && layer.regexp.toString().includes('auth')
        )
      ).toBeDefined();
    });

    test('should have /api/v1/study route', async () => {
      expect(
        app._router.stack.some(
          (layer) => layer.name === 'middleware' && layer.regexp.toString().includes('study')
        )
      ).toBeDefined();
    });

    test('should have /api/v1/users route', async () => {
      expect(
        app._router.stack.some(
          (layer) => layer.name === 'middleware' && layer.regexp.toString().includes('users')
        )
      ).toBeDefined();
    });
  });

  describe('Middleware Stack', () => {
    test('should have CORS middleware', () => {
      const { corsMiddleware } = require('@study-partner/shared');
      expect(corsMiddleware).toBeDefined();
    });

    test('should have security middleware', () => {
      const { securityMiddleware } = require('@study-partner/shared');
      expect(securityMiddleware).toBeDefined();
    });

    test('should have rate limiter middleware', () => {
      const { rateLimiter } = require('@study-partner/shared');
      expect(rateLimiter).toBeDefined();
    });
  });
});
