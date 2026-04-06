/**
 * Integration tests for the Coach route in AI Orchestrator service.
 *
 * Tests verify:
 * - Authentication enforcement
 * - Request forwarding to Python AI service
 * - Error handling
 * - Response structure
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

// Prevent fail-fast app checks from terminating the Jest worker.
process.exit = jest.fn();

const request = require('supertest');
const axios = require('axios');

jest.mock('@study-partner/shared/auth', () => ({
  authenticate: jest.fn((req, res, next) => {
    req.user = { userId: 'test-user-123' };
    next();
  })
}));

jest.mock('@study-partner/shared/tierGate', () => ({
  tierGate: jest.fn(() => (req, res, next) => next())
}));

const app = require('../app');

// Mock axios to prevent actual HTTP calls
jest.mock('axios');

describe('POST /api/v1/ai/coach', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should forward request to Python AI service and return coach decision', async () => {
    // Mock Python service response
    const mockPythonResponse = {
      data: {
        coach_action: {
          action_type: 'silence',
          message: null,
          reasoning:
            'User is deeply focused (ML confidence: 0.92). Never interrupt productive flow state.'
        },
        schedule_update: null,
        timestamp: '2026-02-11T10:30:00'
      }
    };

    axios.post.mockResolvedValue(mockPythonResponse);

    // Make request
    const response = await request(app).post('/api/v1/ai/coach').send({
      ignored_count: 0,
      do_not_disturb: false
    });

    expect([200, 201]).toContain(response.status);
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('action_type');
    expect(response.body).toHaveProperty('reasoning');
    expect(response.body.action_type).toBe('silence');

    // Verify axios was called correctly
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/coach/decision'),
      expect.objectContaining({
        user_id: 'test-user-123',
        ignored_count: 0,
        do_not_disturb: false
      })
    );
  });

  it('should handle do_not_disturb flag correctly', async () => {
    const mockPythonResponse = {
      data: {
        coach_action: {
          action_type: 'silence',
          message: null,
          reasoning: 'Do not disturb is enabled.'
        },
        schedule_update: null,
        timestamp: '2026-02-11T10:30:00'
      }
    };

    axios.post.mockResolvedValue(mockPythonResponse);

    const response = await request(app)
      .post('/api/v1/ai/coach')
      .send({
        do_not_disturb: true
      })
      .expect(200);

    expect(response.body.action_type).toBe('silence');
    expect(response.body.reasoning).toContain('Do not disturb');

    // Verify correct parameters were forwarded
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        do_not_disturb: true
      })
    );
  });

  it('should handle ignored_count parameter correctly', async () => {
    const mockPythonResponse = {
      data: {
        coach_action: {
          action_type: 'silence',
          message: null,
          reasoning: 'Coach was ignored several times. Respecting user preference for autonomy.'
        },
        schedule_update: null,
        timestamp: '2026-02-11T10:30:00'
      }
    };

    axios.post.mockResolvedValue(mockPythonResponse);

    const response = await request(app)
      .post('/api/v1/ai/coach')
      .send({
        ignored_count: 3
      })
      .expect(200);

    expect(response.body.action_type).toBe('silence');

    // Verify correct parameters were forwarded
    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        ignored_count: 3
      })
    );
  });

  it('should return 503 when Python AI service is unreachable', async () => {
    // Mock network error
    axios.post.mockRejectedValue({
      request: {},
      message: 'ECONNREFUSED'
    });

    const response = await request(app)
      .post('/api/v1/ai/coach')
      .send({
        ignored_count: 0
      })
      .expect(503);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain('AI service unavailable');
  });

  it('should handle Python service errors gracefully', async () => {
    // Mock Python service error response
    axios.post.mockRejectedValue({
      response: {
        status: 500,
        data: {
          detail: 'Database connection failed'
        }
      }
    });

    const response = await request(app)
      .post('/api/v1/ai/coach')
      .send({
        ignored_count: 0
      })
      .expect(500);

    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toBe('Coach execution failed');
  });

  it('should reject invalid request with missing required fields', async () => {
    await request(app)
      .post('/api/v1/ai/coach')
      .send({
        invalid_field: 'test'
      })
      .expect(400); // Joi validation rejects unknown fields

    // Should not forward to Python
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('should reject invalid ignored_count (negative number)', async () => {
    const response = await request(app)
      .post('/api/v1/ai/coach')
      .send({
        ignored_count: -5
      })
      .expect(400);

    expect(response.body).toHaveProperty('error');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('should handle coach action with message', async () => {
    // Mock Python service response with a message
    const mockPythonResponse = {
      data: {
        coach_action: {
          action_type: 'suggest_break',
          message: 'You seem quite tired. How about taking a 10-minute break to recharge?',
          reasoning: 'High fatigue levels combined with lost focus indicate need for rest.'
        },
        schedule_update: null,
        timestamp: '2026-02-11T10:30:00'
      }
    };

    axios.post.mockResolvedValue(mockPythonResponse);

    const response = await request(app)
      .post('/api/v1/ai/coach')
      .send({
        ignored_count: 0
      })
      .expect(200);

    expect(response.body.action_type).toBe('suggest_break');
    expect(response.body.coach_message).toContain('break');
    expect(response.body.reasoning).toContain('fatigue');
  });

  it('should use environment variable for AI service URL', async () => {
    const originalEnv = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = 'http://custom-ai-service:9000';

    const mockPythonResponse = {
      data: {
        coach_action: {
          action_type: 'silence',
          message: null,
          reasoning: 'User is focused'
        },
        schedule_update: null,
        timestamp: '2026-02-11T10:30:00'
      }
    };

    axios.post.mockResolvedValue(mockPythonResponse);

    await request(app).post('/api/v1/ai/coach').send({}).expect(200);

    // Verify custom URL was used
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('http://custom-ai-service:9000'),
      expect.any(Object)
    );

    // Restore original environment
    process.env.AI_SERVICE_URL = originalEnv;
  });

  it('should use default URL when environment variable not set', async () => {
    const originalEnv = process.env.AI_SERVICE_URL;
    delete process.env.AI_SERVICE_URL;

    const mockPythonResponse = {
      data: {
        coach_action: {
          action_type: 'silence',
          message: null,
          reasoning: 'User is focused'
        },
        schedule_update: null,
        timestamp: '2026-02-11T10:30:00'
      }
    };

    axios.post.mockResolvedValue(mockPythonResponse);

    await request(app).post('/api/v1/ai/coach').send({}).expect(200);

    // Verify default URL was used
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('localhost:8000'),
      expect.any(Object)
    );

    // Restore original environment
    process.env.AI_SERVICE_URL = originalEnv;
  });
});

describe('GET /api/v1/ai/status', () => {
  it('should return AI service status', async () => {
    const response = await request(app).get('/api/v1/ai/status').expect(200);

    expect(response.body).toHaveProperty('agents');
    expect(response.body.agents).toHaveProperty('coach');
    expect(response.body.agents.coach).toBe('available');
  });
});
