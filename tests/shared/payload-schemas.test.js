/**
 * Payload schema tests (F02 / PLAN-02): Node mirror of workers/schemas.py.
 * Limits must match the Python side exactly — contract drift fails CI.
 */

const { validateJobPayload, validatePlannerPayload, LIMITS } = require('../../shared/ai-messaging/payloadSchemas');
const { AI_JOB_TYPES } = require('../../shared/ai-messaging/envelope');

describe('validatePlannerPayload (study.plan.generate)', () => {
  test('accepts a valid payload', () => {
    const res = validatePlannerPayload({
      goal: 'learn rabbitmq',
      concepts: ['exchanges', 'queues'],
      available_minutes: 90,
      deadline: '2026-12-01T10:00:00Z'
    });
    expect(res).toEqual({ valid: true, errors: [] });
  });

  test('rejects over-length goal at the exact Python limit', () => {
    expect(validatePlannerPayload({ goal: 'x'.repeat(LIMITS.GOAL_MAX_CHARS) }).valid).toBe(true);
    expect(validatePlannerPayload({ goal: 'x'.repeat(LIMITS.GOAL_MAX_CHARS + 1) }).valid).toBe(false);
  });

  test('rejects blank and non-string goals', () => {
    expect(validatePlannerPayload({ goal: '' }).valid).toBe(false);
    expect(validatePlannerPayload({ goal: '   ' }).valid).toBe(false);
    expect(validatePlannerPayload({ goal: 42 }).valid).toBe(false);
    expect(validatePlannerPayload({}).valid).toBe(false);
  });

  test('rejects concept list overflow and long concepts', () => {
    const many = Array.from({ length: LIMITS.CONCEPTS_MAX_ITEMS + 1 }, (_, i) => `c${i}`);
    expect(validatePlannerPayload({ goal: 'g', concepts: many }).valid).toBe(false);
    expect(
      validatePlannerPayload({ goal: 'g', concepts: ['x'.repeat(LIMITS.CONCEPT_MAX_CHARS + 1)] }).valid
    ).toBe(false);
    expect(validatePlannerPayload({ goal: 'g', concepts: [42] }).valid).toBe(false);
  });

  test('rejects bad deadline and available_minutes', () => {
    expect(validatePlannerPayload({ goal: 'g', deadline: 'garbage' }).valid).toBe(false);
    expect(validatePlannerPayload({ goal: 'g', available_minutes: 0 }).valid).toBe(false);
    expect(validatePlannerPayload({ goal: 'g', available_minutes: 1.5 }).valid).toBe(false);
    expect(
      validatePlannerPayload({ goal: 'g', available_minutes: LIMITS.AVAILABLE_MINUTES_MAX + 1 }).valid
    ).toBe(false);
  });

  test('rejects non-object payloads', () => {
    expect(validatePlannerPayload('string').valid).toBe(false);
    expect(validatePlannerPayload([1]).valid).toBe(false);
    expect(validatePlannerPayload(null).valid).toBe(false);
  });
});

describe('validateJobPayload routing', () => {
  test('plan type uses strict validator; other types keep basic rules', () => {
    // eval still requires sessionId (EVAL-02 basic rule preserved)
    expect(validateJobPayload('study.eval.step', {}).valid).toBe(false);
    expect(validateJobPayload('study.eval.step', { sessionId: 's' }).valid).toBe(true);
    expect(validateJobPayload('study.search.query', { query: '' }).valid).toBe(false);
    expect(validateJobPayload('study.ingest.course', { fileRef: 'f' }).valid).toBe(true);
  });

  test('all registered job types have validators', () => {
    for (const type of AI_JOB_TYPES) {
      expect(typeof validateJobPayload(type, {})).toBe('object');
    }
  });
});
