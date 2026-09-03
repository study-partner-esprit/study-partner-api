/**
 * Search API route tests (F05 / SEARCH-02 + SEARCH-07) — supertest against the
 * real app with AiJob + publisher mocked (no broker, no Mongo).
 */

process.env.JWT_SECRET = 'test-secret-key';

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../models/AiJob', () => ({
  createPending: jest.fn(),
  findOne: jest.fn()
}));
jest.mock('@study-partner/shared/ai-messaging', () => ({
  publishAiJob: jest.fn(),
  AI_JOB_TYPES: [
    'study.plan.generate',
    'study.coach.nudge',
    'study.eval.step',
    'study.search.query',
    'study.ingest.course'
  ]
}));

const AiJob = require('../models/AiJob');
const { publishAiJob } = require('@study-partner/shared/ai-messaging');

const app = require('../app');

function authHeader(userId = 'user-1', role = 'user') {
  const token = jwt.sign({ userId, role }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

const VALID_SEARCH = { query: 'what is recursion' };

beforeEach(() => {
  jest.clearAllMocks();
  AiJob.createPending.mockResolvedValue({
    jobId: 'job-s1',
    status: 'PENDING',
    correlationId: 'corr-s1',
    deleteOne: jest.fn().mockResolvedValue(null)
  });
});

describe('POST /api/v1/search/query', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/v1/search/query').send(VALID_SEARCH);
    expect(res.status).toBe(401);
  });

  test('returns 202 with jobId + poll and publishes a study.search.query job', async () => {
    publishAiJob.mockResolvedValue({ messageId: 'm1', correlationId: 'corr-s1' });

    const res = await request(app)
      .post('/api/v1/search/query')
      .set(authHeader())
      .send(VALID_SEARCH);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      jobId: 'job-s1',
      status: 'PENDING',
      correlationId: 'corr-s1',
      poll: '/api/v1/search/jobs/job-s1'
    });

    expect(AiJob.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'study.search.query',
        userId: 'user-1'
      })
    );
    expect(publishAiJob).toHaveBeenCalledWith(
      'study.search.query',
      'user-1',
      VALID_SEARCH,
      expect.objectContaining({
        correlationId: expect.any(String),
        messageId: expect.any(String)
      })
    );
  });

  test('rolls back the PENDING job + 503 when the bus publish fails', async () => {
    publishAiJob.mockRejectedValue(new Error('broker down'));
    const deleteOne = jest.fn().mockResolvedValue(null);
    AiJob.createPending.mockResolvedValue({
      jobId: 'job-s1',
      status: 'PENDING',
      correlationId: 'corr-s1',
      deleteOne
    });

    const res = await request(app)
      .post('/api/v1/search/query')
      .set(authHeader())
      .send(VALID_SEARCH);

    expect(res.status).toBe(503);
    expect(deleteOne).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid payloads via validation (SEARCH-02)', async () => {
    const cases = [
      [{}],                          // missing query
      [{ query: '' }],               // blank query
      [{ query: 'a'.repeat(501) }],  // over-long query
      [{ query: 'test', maxResults: 11 }], // out-of-range maxResults
      [{ query: 'test', voiceMode: 'yes' }], // wrong type
      [{ query: 'test', evilField: 'x' }],   // unknown field
    ];

    for (const [payload] of cases) {
      const res = await request(app)
        .post('/api/v1/search/query')
        .set(authHeader())
        .send(payload);
      expect(res.status).toBe(422);
      expect(AiJob.createPending).not.toHaveBeenCalled();
    }
  });

  test('accepts valid payload with all optional fields and publishes them', async () => {
    publishAiJob.mockResolvedValue({ messageId: 'm1', correlationId: 'corr-s1' });

    const res = await request(app)
      .post('/api/v1/search/query')
      .set(authHeader())
      .send({ query: 'hello', maxResults: 3, voiceMode: true, sessionId: 'sess-1' });

    expect(res.status).toBe(202);
    expect(publishAiJob).toHaveBeenCalledWith(
      'study.search.query',
      'user-1',
      { query: 'hello', maxResults: 3, voiceMode: true, sessionId: 'sess-1' },
      expect.anything()
    );
  });
});

describe('GET /api/v1/search/jobs/:jobId', () => {
  test('returns status + answer/sources for the owning user', async () => {
    AiJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        jobId: 'job-s1',
        type: 'study.search.query',
        status: 'COMPLETED',
        attempts: 1,
        result: { answer: 'Recursion is self-reference.', sources: [{ url: 'https://en.wikipedia.org/wiki/Recursion' }] },
        error: null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    });

    const res = await request(app).get('/api/v1/search/jobs/job-s1').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.result).toMatchObject({
      answer: 'Recursion is self-reference.',
      sources: [{ url: 'https://en.wikipedia.org/wiki/Recursion' }]
    });
  });

  test('scopes the query to the owning user (non-admin)', async () => {
    AiJob.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await request(app).get('/api/v1/search/jobs/job-s1').set(authHeader('user-2'));

    expect(AiJob.findOne).toHaveBeenCalledWith({
      jobId: 'job-s1',
      type: 'study.search.query',
      userId: 'user-2'
    });
  });

  test('admin can read any search job', async () => {
    AiJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ jobId: 'job-s1', status: 'PENDING' })
    });

    await request(app).get('/api/v1/search/jobs/job-s1').set(authHeader('admin-1', 'admin'));

    expect(AiJob.findOne).toHaveBeenCalledWith({
      jobId: 'job-s1',
      type: 'study.search.query'
    });
  });

  test('404 for unknown or non-search jobs', async () => {
    AiJob.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(app).get('/api/v1/search/jobs/nope').set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('search job not found');
  });
});
