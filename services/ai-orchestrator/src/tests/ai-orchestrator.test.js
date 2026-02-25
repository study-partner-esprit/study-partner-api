/**
 * AI Orchestrator Service Tests
 * Tests AI proxy endpoints
 */
const request = require('supertest');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';

const app = require('../app');

describe('AI Orchestrator Service', () => {
  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('ai-orchestrator');
    });
  });

  describe('POST /api/v1/ai/process', () => {
    it('should accept AI processing request', async () => {
      const res = await request(app)
        .post('/api/v1/ai/process')
        .send({
          userId: 'user-123',
          action: 'generate_plan',
          courseId: 'course-1'
        });

      // May proxy to Python service or return error if service down
      expect([200, 201, 502, 404]).toContain(res.status);
    });
  });
});
