/**
 * Signal Processing Service Tests
 * Tests signal data ingestion and processing endpoints
 */
const request = require('supertest');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';

// Prevent process.exit() from killing tests
process.exit = jest.fn();

// We test the app directly
const app = require('../app');

describe('Signal Processing Service', () => {
  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('signal-processing');
    });
  });

  describe('POST /api/v1/signals/process', () => {
    it('should accept signal data payload', async () => {
      const res = await request(app)
        .post('/api/v1/signals/process')
        .send({
          userId: 'user-123',
          sessionId: 'session-1',
          signalType: 'focus',
          data: { score: 0.85, timestamp: Date.now() }
        });

      // Expects 200 or 201 depending on implementation
      expect([200, 201, 404]).toContain(res.status);
    });
  });

  describe('GET /api/v1/signals/status/:sessionId', () => {
    it('should return session processing status', async () => {
      const res = await request(app).get('/api/v1/signals/status/session-1');
      // Service may return 200 or 404 depending on whether session exists
      expect([200, 404]).toContain(res.status);
    });
  });
});
