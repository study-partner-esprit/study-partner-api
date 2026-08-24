/**
 * Integration tests for the AI jobs API + AiJob state machine (AI-COM-07).
 *
 * Prerequisites: MongoDB on localhost:27017. Publishing is mocked at the
 * shared messaging boundary (broker round-trip is AI-COM-10's job).
 */

const request = require('supertest');
const mongoose = require('mongoose');

jest.setTimeout(30000);

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'integration-test-refresh-secret';
process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner_test';
process.env.NODE_ENV = 'test';

jest.mock('@study-partner/shared/ai-messaging', () => {
  const actual = jest.requireActual('../../shared/ai-messaging/envelope');
  const topology = jest.requireActual('../../shared/ai-messaging/topology');
  return {
    ...actual,
    ...topology,
    publishAiJob: jest.fn(async (type) => ({
      messageId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      correlationId: '0f8e2d1a-3b4c-4d6e-8f80-91a2b3c4d5e6'
    })),
    consumeAiResults: jest.fn(async () => ({})),
    closeAiMessaging: jest.fn(async () => {})
  };
});

process.exit = jest.fn();

const { publishAiJob } = require('@study-partner/shared/ai-messaging');
const app = require('../../services/ai-orchestrator/src/app');
const AiJob = require('../../services/ai-orchestrator/src/models/AiJob');
const { generateToken } = require('../../shared/auth');

let token;
const userA = { userId: 'job-user-a', email: 'a@test.com', role: 'student' };
const userB = { userId: 'job-user-b', email: 'b@test.com', role: 'student' };
let tokenA;
let tokenB;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  });
  await AiJob.deleteMany({});
  tokenA = `Bearer ${generateToken(userA)}`;
  tokenB = `Bearer ${generateToken(userB)}`;
});

afterEach(async () => {
  publishAiJob.mockClear();
});

afterAll(async () => {
  await AiJob.deleteMany({});
  await mongoose.disconnect();
});

describe('POST /api/v1/ai/jobs', () => {
  test('creates PENDING job and returns 202 with poll URL', async () => {
    const res = await request(app)
      .post('/api/v1/ai/jobs')
      .set('Authorization', tokenA)
      .send({ type: 'study.plan.generate', payload: { goal: 'master graphs' } });

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('PENDING');
    expect(publishAiJob).toHaveBeenCalledTimes(1);

    const job = await AiJob.findOne({ jobId: res.body.jobId });
    expect(job.userId).toBe(userA.userId); // from auth context
    expect(job.correlationId).toBeDefined();
  });

  test('rejects unknown type with 400', async () => {
    const res = await request(app)
      .post('/api/v1/ai/jobs')
      .set('Authorization', tokenA)
      .send({ type: 'study.plan.nuke', payload: {} });
    expect(res.status).toBe(400);
    expect(publishAiJob).not.toHaveBeenCalled();
  });

  test('validates planner payload bounds with 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/jobs')
      .set('Authorization', tokenA)
      .send({ type: 'study.plan.generate', payload: { goal: '' } });
    expect(res.status).toBe(422);
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .post('/api/v1/ai/jobs')
      .send({ type: 'study.plan.generate', payload: { goal: 'x' } });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/ai/jobs/:jobId', () => {
  let jobId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/ai/jobs')
      .set('Authorization', tokenA)
      .send({ type: 'study.search.query', payload: { query: 'transformers' } });
    jobId = res.body.jobId;
  });

  test('owner can read own job status', async () => {
    const res = await request(app)
      .get(`/api/v1/ai/jobs/${jobId}`)
      .set('Authorization', tokenA);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
  });

  test('another user gets 404 (no cross-user access)', async () => {
    const res = await request(app)
      .get(`/api/v1/ai/jobs/${jobId}`)
      .set('Authorization', tokenB);
    expect(res.status).toBe(404);
  });
});

describe('state machine', () => {
  test('enforces valid transitions only', async () => {
    const job = await AiJob.createPending({
      type: 'study.eval.step',
      userId: userA.userId,
      correlationId: '0f8e2d1a-3b4c-4d6e-8f80-91a2b3c4d5e7',
      messageId: '7c9e6679-7425-40de-944b-e07fc1f90ae8',
      requestId: 'r1'
    });
    await job.transitionTo('PROCESSING');
    await job.transitionTo('COMPLETED');

    expect(() => job.transitionTo('PROCESSING')).toThrow(
      /invalid job transition/
    );
    expect(() => job.transitionTo('FAILED')).toThrow(/invalid job transition/);
    expect(job.expireAt).toBeTruthy(); // TTL cleanup scheduled
  });

  test('completeByCorrelation is idempotent for duplicate results', async () => {
    const correlationId = '0f8e2d1a-3b4c-4d6e-8f80-91a2b3c4d5e9';
    await AiJob.createPending({
      type: 'study.search.query',
      userId: userA.userId,
      correlationId,
      messageId: '7c9e6679-7425-40de-944b-e07fc1f90ae9',
      requestId: 'r2'
    });
    const first = await AiJob.completeByCorrelation(correlationId, { answer: 'x' });
    const second = await AiJob.completeByCorrelation(correlationId, { answer: 'y' });
    expect(first.result.answer).toBe('x'); // first write wins
    expect(second._id.equals(first._id)).toBe(true);
  });

  test('failByCorrelation sanitizes long errors to 512 chars', async () => {
    const correlationId = '0f8e2d1a-3b4c-4d6e-8f80-91a2b3c4d5ea';
    await AiJob.createPending({
      type: 'study.coach.nudge',
      userId: userA.userId,
      correlationId,
      messageId: '7c9e6679-7425-40de-944b-e07fc1f90ab0',
      requestId: 'r3'
    });
    const job = await AiJob.failByCorrelation(correlationId, 'x'.repeat(5000));
    expect(job.error.length).toBeLessThanOrEqual(512);
    expect(job.status).toBe('FAILED');
  });
});
