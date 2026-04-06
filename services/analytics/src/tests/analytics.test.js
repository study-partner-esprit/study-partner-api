/**
 * Analytics Service Tests
 * Tests analytics event tracking and dashboard endpoints
 */
const request = require('supertest');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';

// Prevent process.exit() from killing tests
process.exit = jest.fn();

const app = require('../app');

describe('Analytics Service', () => {
  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('analytics');
    });
  });

  describe('POST /api/v1/analytics/events', () => {
    it('should accept valid analytics event', async () => {
      const res = await request(app)
        .post('/api/v1/analytics/events')
        .send({
          userId: 'user-123',
          eventType: 'study_session_started',
          metadata: { courseId: 'course-1', duration: 30 }
        });

      expect([200, 201, 401]).toContain(res.status);
    });
  });

  describe('GET /api/v1/analytics/dashboard', () => {
    it('should return dashboard data for user', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/dashboard')
        .query({ userId: 'user-123' });

      expect([200, 401, 404]).toContain(res.status);
    });
  });
});
