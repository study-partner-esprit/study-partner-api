/**
 * EVAL-08 tests: per-step EvalResult persistence (builder + store + consumer).
 * Store/consumer modules are unit-tested with mocked models — no broker or
 * MongoDB required.
 */

const AiJob = require('../models/AiJob');
const EvalResult = require('../models/EvalResult');

jest.mock('../models/AiJob', () => ({
  completeByCorrelation: jest.fn(),
  failByCorrelation: jest.fn()
}));
jest.mock('../models/EvalResult', () => ({
  updateOne: jest.fn(),
  find: jest.fn()
}));

jest.mock('../services/evalResultStore', () => ({
  upsertByCorrelation: jest.fn(),
  listStepsForSession: jest.fn()
}));
jest.mock('../services/evalResultBuilder', () => ({
  buildEvalResultRecord: jest.fn(),
  EVAL_JOB_TYPE: 'study.eval.step'
}));

const { buildEvalResultRecord } = jest.requireActual('../services/evalResultBuilder');
const store = require('../services/evalResultStore');
const builder = require('../services/evalResultBuilder');
const { upsertByCorrelation: storeUpsert, listStepsForSession: realListSteps } = jest.requireActual(
  '../services/evalResultStore'
);
const { handleResult } = require('../services/jobResultConsumer');

const EVAL_JOB_TYPE = 'study.eval.step';

const completedEvalResult = () => ({
  correlationId: 'corr-1',
  messageId: 'msg-1',
  userId: 'user-123',
  type: EVAL_JOB_TYPE,
  status: 'completed',
  requestId: 'req-1',
  payload: {
    sessionId: 'sess-1',
    step: 2,
    state: 'CONTINUE',
    mastery_score: 0.7,
    demonstratedBloomLevel: 'UNDERSTAND',
    objectiveId: 'obj-9',
    targetBloomLevel: 'APPLY',
    next_question: 'Why does the base case stop recursion?',
    evaluation_output: {
      session_status: 'CONTINUE',
      concept_coverage: 0.8,
      logical_coherence: 0.6,
      causal_reasoning: 1.0,
      error_awareness: 0.5,
      specificity: 0.7,
      mastery_score: 0.7,
      demonstrated_bloom_level: 'UNDERSTAND',
      target_bloom_level: 'APPLY',
      next_question: 'Why does the base case stop recursion?'
    }
  }
});

// ------------------------------------------------------ buildEvalResultRecord

describe('buildEvalResultRecord (real implementation)', () => {
  test('builds a complete record from a step result', () => {
    const rec = buildEvalResultRecord(completedEvalResult());
    expect(rec).toMatchObject({
      correlationId: 'corr-1',
      messageId: 'msg-1',
      userId: 'user-123',
      sessionId: 'sess-1',
      step: 2,
      status: 'CONTINUE',
      masteryScore: 0.7,
      nextQuestion: 'Why does the base case stop recursion?',
      demonstratedBloomLevel: 'UNDERSTAND',
      objectiveId: 'obj-9',
      targetBloomLevel: 'APPLY'
    });
    expect(rec.scores).toEqual({
      concept_coverage: 0.8,
      logical_coherence: 0.6,
      causal_reasoning: 1.0,
      error_awareness: 0.5,
      specificity: 0.7,
      mastery_score: 0.7
    });
  });

  test('falls back to evaluation_output when carrier fields are absent', () => {
    const rec = buildEvalResultRecord({
      correlationId: 'c2',
      messageId: 'm2',
      type: EVAL_JOB_TYPE,
      payload: {
        sessionId: 's2',
        step: 1,
        state: 'MASTERY_CONFIRMED',
        evaluation_output: {
          session_status: 'MASTERY_CONFIRMED',
          demonstrated_bloom_level: 'CREATE',
          next_question: 'q'
        }
      }
    });
    expect(rec.status).toBe('MASTERY_CONFIRMED');
    expect(rec.demonstratedBloomLevel).toBe('CREATE');
    expect(rec.nextQuestion).toBe('q');
    expect(rec.objectiveId).toBeNull();
    expect(rec.targetBloomLevel).toBeNull();
    expect(rec.masteryScore).toBeNull();
    expect(rec.scores).toEqual({});
  });

  test('returns null for non-eval job types', () => {
    expect(
      buildEvalResultRecord({ type: 'study.plan.generate', payload: { goal: 'x' } })
    ).toBeNull();
  });

  test('returns null for malformed eval results', () => {
    expect(buildEvalResultRecord({ type: EVAL_JOB_TYPE, payload: { sessionId: 42 } })).toBeNull();
    expect(
      buildEvalResultRecord({ type: EVAL_JOB_TYPE, payload: { sessionId: 's', step: 1.5 } })
    ).toBeNull();
    expect(buildEvalResultRecord(null)).toBeNull();
    expect(buildEvalResultRecord(undefined)).toBeNull();
  });
});

// ------------------------------------------------------------- evalResultStore

describe('evalResultStore (mocked model)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upsertByCorrelation is keyed by correlationId with upsert flag', async () => {
    EvalResult.updateOne.mockResolvedValue({});
    await storeUpsert({
      correlationId: 'corr-1',
      messageId: 'msg-1',
      userId: 'user-123',
      sessionId: 'sess-1',
      step: 2,
      status: 'CONTINUE',
      masteryScore: 0.7,
      scores: { concept_coverage: 0.8 },
      nextQuestion: 'q',
      demonstratedBloomLevel: 'UNDERSTAND',
      objectiveId: 'obj-9',
      targetBloomLevel: 'APPLY'
    });
    expect(EvalResult.updateOne).toHaveBeenCalledTimes(1);
    expect(EvalResult.updateOne).toHaveBeenCalledWith(
      { correlationId: 'corr-1' },
      { $set: expect.objectContaining({ sessionId: 'sess-1', step: 2 }) },
      { upsert: true }
    );
  });

  test('listStepsForSession queries by sessionId and sorts ascending', async () => {
    EvalResult.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ step: 1 }, { step: 2 }])
    });
    const steps = await realListSteps('sess-1');
    expect(EvalResult.find).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(steps).toHaveLength(2);
  });
});

// ----------------------------------------------------------- jobResultConsumer

describe('handleResult (mocked deps)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('completed eval result persists a per-step record', async () => {
    AiJob.completeByCorrelation.mockResolvedValue({ status: 'COMPLETED' });
    builder.buildEvalResultRecord.mockReturnValue({
      correlationId: 'corr-1',
      sessionId: 'sess-1',
      step: 2
    });
    store.upsertByCorrelation.mockResolvedValue('corr-1');

    await handleResult(completedEvalResult());

    expect(AiJob.completeByCorrelation).toHaveBeenCalledWith('corr-1', expect.any(Object));
    expect(builder.buildEvalResultRecord).toHaveBeenCalled();
    expect(store.upsertByCorrelation).toHaveBeenCalledWith({
      correlationId: 'corr-1',
      sessionId: 'sess-1',
      step: 2
    });
  });

  test('completed NON-eval result skips eval persistence', async () => {
    AiJob.completeByCorrelation.mockResolvedValue({ status: 'COMPLETED' });
    builder.buildEvalResultRecord.mockReturnValue(null);

    await handleResult({
      correlationId: 'c3',
      messageId: 'm3',
      type: 'study.plan.generate',
      status: 'completed',
      payload: { goal: 'learn' }
    });

    expect(AiJob.completeByCorrelation).toHaveBeenCalled();
    expect(store.upsertByCorrelation).not.toHaveBeenCalled();
  });

  test('unmatched completed job still attemps eval persistence', async () => {
    AiJob.completeByCorrelation.mockResolvedValue(null);
    builder.buildEvalResultRecord.mockReturnValue({
      correlationId: 'corr-1',
      sessionId: 's1',
      step: 1
    });
    store.upsertByCorrelation.mockResolvedValue('corr-1');

    await handleResult(completedEvalResult());

    expect(store.upsertByCorrelation).toHaveBeenCalledTimes(1);
  });

  test('failed result fails the AiJob and never persists an eval record', async () => {
    AiJob.failByCorrelation.mockResolvedValue({ status: 'FAILED' });

    await handleResult({
      correlationId: 'c4',
      messageId: 'm4',
      type: EVAL_JOB_TYPE,
      status: 'failed',
      error: 'LLM quota exceeded'
    });

    expect(AiJob.failByCorrelation).toHaveBeenCalledWith('c4', 'LLM quota exceeded');
    expect(store.upsertByCorrelation).not.toHaveBeenCalled();
    expect(AiJob.completeByCorrelation).not.toHaveBeenCalled();
  });
});
