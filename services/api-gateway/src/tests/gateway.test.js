/**
 * API Gateway Tests
 * Tests health check, route existence, and error handling
 */
const request = require('supertest');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
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
});
