/**
 * Eval API route tests (F04 / EVAL-09) — supertest against the real app with
 * AiJob + publisher mocked (no broker, no Mongo).
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
jest.mock('../services/objectiveContext', () => ({
  resolveObjectiveContext: jest.fn()
}));

const AiJob = require('../models/AiJob');
const { publishAiJob } = require('@study-partner/shared/ai-messaging');
const { resolveObjectiveContext } = require('../services/objectiveContext');

const app = require('../app');

function authHeader(userId = 'user-1', role = 'user') {
  const token = jwt.sign({ userId, role }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

const VALID_STEP = {
  sessionId: 'sess-9',
  step: 1,
  contextId: 'ctx-recursion',
  studentAnswer:
    'Recursion needs a base case that stops it and a recursive case that reduces the problem.'
};

beforeEach(() => {
  jest.clearAllMocks();
  AiJob.createPending.mockResolvedValue({
    jobId: 'job-1',
    status: 'PENDING',
    correlationId: 'corr-1',
    deleteOne: jest.fn().mockResolvedValue(null)
  });
});

describe('POST /api/v1/eval/step', () => {
  test('returns 202 with jobId + poll and publishes a study.eval.step job', async () => {
    publishAiJob.mockResolvedValue({ messageId: 'm1', correlationId: 'corr-1' });

    const res = await request(app).post('/api/v1/eval/step').set(authHeader()).send(VALID_STEP);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      jobId: 'job-1',
      status: 'PENDING',
      correlationId: 'corr-1',
      sessionId: 'sess-9',
      step: 1,
      poll: '/api/v1/eval/jobs/job-1'
    });

    expect(AiJob.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'study.eval.step',
        userId: 'user-1',
        correlationId: expect.any(String),
        messageId: expect.any(String)
      })
    );
    expect(publishAiJob).toHaveBeenCalledWith(
      'study.eval.step',
      'user-1',
      VALID_STEP,
      expect.objectContaining({
        correlationId: expect.any(String),
        messageId: expect.any(String)
      })
    );
  });

  test('rejects 422 when the eval payload fails validation (no publish)', async () => {
    const res = await request(app)
      .post('/api/v1/eval/step')
      .set(authHeader())
      .send({ step: 1, contextId: 'ctx', studentAnswer: 'answer' });

    expect(res.status).toBe(422);
    expect(AiJob.createPending).not.toHaveBeenCalled();
    expect(publishAiJob).not.toHaveBeenCalled();
  });

  test('rejects blank objectiveId via payload validation parity', async () => {
    const res = await request(app)
      .post('/api/v1/eval/step')
      .set(authHeader())
      .send({ ...VALID_STEP, objectiveId: '   ' });

    expect(res.status).toBe(422);
    expect(publishAiJob).not.toHaveBeenCalled();
  });

  test('EVAL-02b: resolves objective context and injects targetBloomLevel + knowledgeType', async () => {
    publishAiJob.mockResolvedValue({ messageId: 'm1', correlationId: 'corr-1' });
    resolveObjectiveContext.mockResolvedValue({
      targetBloomLevel: 'APPLY',
      knowledgeType: 'procedural'
    });

    const res = await request(app)
      .post('/api/v1/eval/step')
      .set(authHeader())
      .send({ ...VALID_STEP, objectiveId: 'obj-apply' });

    expect(res.status).toBe(202);
    expect(resolveObjectiveContext).toHaveBeenCalledWith('obj-apply');
    expect(publishAiJob).toHaveBeenCalledWith(
      'study.eval.step',
      'user-1',
      expect.objectContaining({
        objectiveId: 'obj-apply',
        targetBloomLevel: 'APPLY',
        knowledgeType: 'procedural'
      }),
      expect.anything()
    );
  });

  test('EVAL-02b: skips objective resolution when objectiveId is absent', async () => {
    publishAiJob.mockResolvedValue({ messageId: 'm1', correlationId: 'corr-1' });

    await request(app).post('/api/v1/eval/step').set(authHeader()).send(VALID_STEP);

    expect(resolveObjectiveContext).not.toHaveBeenCalled();
    expect(publishAiJob).toHaveBeenCalledWith(
      'study.eval.step',
      'user-1',
      expect.not.objectContaining({ targetBloomLevel: expect.anything() }),
      expect.anything()
    );
  });

  test('EVAL-02b: 422 when the objective is not found or inactive (no publish)', async () => {
    resolveObjectiveContext.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/eval/step')
      .set(authHeader())
      .send({ ...VALID_STEP, objectiveId: 'obj-missing' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('objective not found or inactive');
    expect(AiJob.createPending).not.toHaveBeenCalled();
    expect(publishAiJob).not.toHaveBeenCalled();
  });

  test('requires authentication', async () => {
    const res = await request(app).post('/api/v1/eval/step').send(VALID_STEP);
    expect(res.status).toBe(401);
  });

  test('rolls back the PENDING job + 503 when the bus publish fails', async () => {
    publishAiJob.mockRejectedValue(new Error('broker down'));
    const deleteOne = jest.fn().mockResolvedValue(null);
    AiJob.createPending.mockResolvedValue({
      jobId: 'job-1',
      status: 'PENDING',
      correlationId: 'corr-1',
      deleteOne
    });

    const res = await request(app).post('/api/v1/eval/step').set(authHeader()).send(VALID_STEP);

    expect(res.status).toBe(503);
    expect(deleteOne).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/eval/jobs/:jobId', () => {
  test('returns status + step result for the owning user', async () => {
    AiJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        jobId: 'job-1',
        type: 'study.eval.step',
        status: 'COMPLETED',
        attempts: 1,
        result: { state: 'CONTINUE', mastery_score: 0.8, next_question: 'Why?' },
        error: null,
        fallbackUsed: false,
        createdAt: new Date(),
        updatedAt: new Date()
      })
    });

    const res = await request(app).get('/api/v1/eval/jobs/job-1').set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.result).toMatchObject({ state: 'CONTINUE', mastery_score: 0.8 });
  });

  test('scopes the query to the owning user (non-admin)', async () => {
    AiJob.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    await request(app).get('/api/v1/eval/jobs/job-1').set(authHeader('user-2'));

    expect(AiJob.findOne).toHaveBeenCalledWith({
      jobId: 'job-1',
      type: 'study.eval.step',
      userId: 'user-2'
    });
  });

  test('admin can read any eval job', async () => {
    AiJob.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'PENDING' })
    });

    await request(app).get('/api/v1/eval/jobs/job-1').set(authHeader('admin-1', 'admin'));

    expect(AiJob.findOne).toHaveBeenCalledWith({
      jobId: 'job-1',
      type: 'study.eval.step'
    });
  });

  test('404 for unknown or non-eval jobs', async () => {
    AiJob.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const res = await request(app).get('/api/v1/eval/jobs/nope').set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('eval job not found');
  });
});
