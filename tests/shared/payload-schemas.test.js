/**
 * Payload schema tests (F02 / PLAN-02): Node mirror of workers/schemas.py.
 * Limits must match the Python side exactly — contract drift fails CI.
 */

const { validateJobPayload, validatePlannerPayload, validateCoachPayload, LIMITS } = require('../../shared/ai-messaging/payloadSchemas');
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
  test('plan and coach use strict validators; eval/search/ingest keep basic rules', () => {
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

describe('validateCoachPayload (study.coach.nudge)', () => {
  test('accepts an empty payload (all fields optional)', () => {
    expect(validateJobPayload('study.coach.nudge', {})).toEqual({ valid: true, errors: [] });
  });

  test('accepts a full session context payload', () => {
    const res = validateCoachPayload({
      session_id: 'sess-123',
      signals: [
        {
          timestamp: '2026-08-26T08:00:00Z',
          focus_state: 'Focused',
          focus_score: 0.8,
          fatigue_state: 'Alert',
          fatigue_score: 0.1,
          focus_confidence: 0.9,
          focus_trend: -0.05
        }
      ],
      messages: [
        { role: 'user', content: 'I feel drained.' },
        { role: 'assistant', content: 'Take a rest.' }
      ],
      focus_state: 'Drifting',
      focus_score: 0.4,
      fatigue_score: 0.7,
      ignored_count: 2,
      do_not_disturb: false,
      current_time: '2026-08-26T08:05:00Z'
    });
    expect(res.valid).toBe(true);
  });

  test('rejects userId and any unknown fields in the body', () => {
    expect(validateCoachPayload({ userId: 'u' }).valid).toBe(false);
    expect(validateCoachPayload({ mystery_field: 1 }).valid).toBe(false);
  });

  test('enforces the signal window cap (20)', () => {
    const signal = {
      timestamp: '2026-08-26T08:00:00Z',
      focus_state: 'Focused',
      focus_score: 0.8,
      fatigue_state: 'Alert',
      fatigue_score: 0.1
    };
    const ok = Array.from({ length: LIMITS.COACH_MAX_SIGNALS }, () => signal);
    expect(validateCoachPayload({ signals: ok }).valid).toBe(true);
    expect(validateCoachPayload({ signals: [...ok, signal] }).valid).toBe(false);
  });

  test('rejects over-length message content at the exact Python limit', () => {
    expect(
      validateCoachPayload({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.COACH_MESSAGE_MAX_CHARS) }] }).valid
    ).toBe(true);
    expect(
      validateCoachPayload({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.COACH_MESSAGE_MAX_CHARS + 1) }] }).valid
    ).toBe(false);
  });

  test('caps total payload size at 16 KB', () => {
    const big = {
      messages: Array.from({ length: 10 }, () => ({ role: 'user', content: 'y'.repeat(2000) }))
    };
    expect(validateCoachPayload(big).valid).toBe(false);
  });

  test('rejects bad states, scores, counts and types', () => {
    expect(validateCoachPayload({ focus_state: 'zombie' }).valid).toBe(false);
    expect(validateCoachPayload({ focus_score: 1.5 }).valid).toBe(false);
    expect(validateCoachPayload({ focus_score: true }).valid).toBe(false);
    expect(validateCoachPayload({ ignored_count: -1 }).valid).toBe(false);
    expect(validateCoachPayload({ do_not_disturb: 'yes' }).valid).toBe(false);
    expect(validateCoachPayload({ current_time: 'not-a-date' }).valid).toBe(false);
    expect(validateCoachPayload('just a string').valid).toBe(false);
  });
});
