/**
 * API Gateway Tests
 * Tests health check, route existence, and error handling
 */
const request = require('supertest');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.INTERNAL_API_SECRET = 'test-internal-secret';
process.env.NODE_ENV = 'test';

const app = require('../app');

describe('API Gateway', () => {
  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('api-gateway');
    });
  });

  describe('Undefined routes', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/v1/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const res = await request(app)
        .options('/api/v1/health')
        .set('Origin', 'http://localhost:5173');

      expect([200, 204]).toContain(res.status);
      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('INGEST-03 content-type allowlist', () => {
    it('rejects JSON POST to course upload with 415', async () => {
      const res = await request(app)
        .post('/api/v1/study/courses')
        .set('Content-Type', 'application/json')
        .send({ title: 'Bad', subject_id: 'subj-1' });

      expect(res.status).toBe(415);
      expect(res.body.error).toMatch(/multipart\/form-data/);
    });

    it('rejects JSON POST to re-ingest route with 415', async () => {
      const res = await request(app)
        .post('/api/v1/study/courses/course-1/files')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('file=not-a-file');

      expect(res.status).toBe(415);
      expect(res.body.error).toMatch(/multipart\/form-data/);
    });

    it('allows multipart/form-data through to the proxy', async () => {
      const res = await request(app)
        .post('/api/v1/study/courses')
        .set('Content-Type', 'multipart/form-data; boundary=----x')
        .send('--x\r\n\r\n--x--');

      // Reaches the proxy (no downstream service running in unit test) → 502 proxy error.
      expect(res.status).toBe(502);
    });
  });

  describe('SEC-07 monitoring endpoint protection', () => {
    it('rejects /api/v1/monitoring/metrics without an internal secret', async () => {
      const res = await request(app).get('/api/v1/monitoring/metrics');
      expect(res.status).toBe(403);
    });

    it('rejects /api/v1/monitoring/metrics with a wrong internal secret', async () => {
      const res = await request(app)
        .get('/api/v1/monitoring/metrics')
        .set('x-internal-secret', 'wrong-secret');
      expect(res.status).toBe(403);
    });

    it('serves metrics to internal callers presenting x-internal-secret', async () => {
      const res = await request(app)
        .get('/api/v1/monitoring/metrics')
        .set('x-internal-secret', 'test-internal-secret');
      expect(res.status).toBe(200);
      expect(res.body.total_requests).toBeDefined();
      expect(res.body.error_rate).toMatch(/%$/);
    });

    it('keeps the health endpoint public', async () => {
      const res = await request(app).get('/api/v1/monitoring/health');
      expect([200, 207]).toContain(res.status);
      expect(res.body.status).toMatch(/healthy|degraded/);
    });
  });
});
