/**
 * Payload schema tests (F02 / PLAN-02): Node mirror of workers/schemas.py.
 * Limits must match the Python side exactly — contract drift fails CI.
 */

const { validateJobPayload, validatePlannerPayload, validateCoachPayload, validateSessionStats, validateScheduleApplyPayload, LIMITS } = require('../../shared/ai-messaging/payloadSchemas');
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
      session_stats: {
        progress_pct: 50,
        minutes_elapsed: 25,
        task_switches: 2,
        break_count: 1,
        current_streak_days: 4
      },
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

describe('validateScheduleApplyPayload (study.schedule.apply / COACH-16)', () => {
  const valid = { action: 'add_break', duration_minutes: 10, affected_task_ids: ['t1'], reasoning: 'coach suggested a break' };

  test('accepts a valid payload via the job router', () => {
    expect(validateJobPayload('study.schedule.apply', valid)).toEqual({ valid: true, errors: [] });
    expect(validateScheduleApplyPayload(valid)).toEqual({ valid: true, errors: [] });
  });

  test('accepts empty optionals and the exact upper bounds', () => {
    expect(validateScheduleApplyPayload({ action: 'suspend_session' }).valid).toBe(true);
    expect(
      validateScheduleApplyPayload({ ...valid, duration_minutes: LIMITS.SCHEDULE_MAX_DURATION_MINUTES }).valid
    ).toBe(true);
    expect(
      validateScheduleApplyPayload({
        ...valid,
        affected_task_ids: Array.from({ length: LIMITS.SCHEDULE_MAX_AFFECTED_TASK_IDS }, (_, i) => `t${i}`)
      }).valid
    ).toBe(true);
    expect(validateScheduleApplyPayload({ ...valid, reasoning: 'x'.repeat(LIMITS.SCHEDULE_REASONING_MAX_CHARS) }).valid).toBe(true);
  });

  test('rejects unknown action, unknown fields and non-objects', () => {
    expect(validateScheduleApplyPayload({ action: 'delete_everything' }).valid).toBe(false);
    expect(validateScheduleApplyPayload({ ...valid, hacked: 1 }).valid).toBe(false);
    expect(validateScheduleApplyPayload('nope').valid).toBe(false);
    expect(validateScheduleApplyPayload([1]).valid).toBe(false);
  });

  test('rejects duration bounds, floats and booleans', () => {
    expect(validateScheduleApplyPayload({ ...valid, duration_minutes: 0 }).valid).toBe(false);
    expect(validateScheduleApplyPayload({ ...valid, duration_minutes: LIMITS.SCHEDULE_MAX_DURATION_MINUTES + 1 }).valid).toBe(false);
    expect(validateScheduleApplyPayload({ ...valid, duration_minutes: 1.5 }).valid).toBe(false);
    expect(validateScheduleApplyPayload({ ...valid, duration_minutes: true }).valid).toBe(false);
  });

  test('rejects affected_task_ids overflow, blanks and non-strings', () => {
    expect(
      validateScheduleApplyPayload({
        ...valid,
        affected_task_ids: Array.from({ length: LIMITS.SCHEDULE_MAX_AFFECTED_TASK_IDS + 1 }, (_, i) => `t${i}`)
      }).valid
    ).toBe(false);
    expect(validateScheduleApplyPayload({ ...valid, affected_task_ids: ['  '] }).valid).toBe(false);
    expect(validateScheduleApplyPayload({ ...valid, affected_task_ids: [true] }).valid).toBe(false);
  });

  test('accepts ISO new_start_time and rejects garbage', () => {
    expect(validateScheduleApplyPayload({ ...valid, action: 'reschedule_task', new_start_time: '2026-08-31T15:00:00Z' }).valid).toBe(true);
    expect(validateScheduleApplyPayload({ ...valid, new_start_time: 'garbage' }).valid).toBe(false);
  });

  test('caps total payload size', () => {
    expect(validateScheduleApplyPayload({ ...valid, reasoning: 'x'.repeat(LIMITS.SCHEDULE_MAX_PAYLOAD_BYTES) }).valid).toBe(false);
  });

  test('rejects userId in the schedule body (identity comes from envelope)', () => {
    expect(validateScheduleApplyPayload({ ...valid, userId: 'u' }).valid).toBe(false);
  });
});

describe('validateSessionStats (COACH-13)', () => {
  const valid = {
    progress_pct: 42,
    minutes_elapsed: 25,
    task_switches: 3,
    break_count: 2,
    current_streak_days: 7
  };

  test('accepts a fully bounded stats block', () => {
    expect(validateCoachPayload({ session_stats: valid }).valid).toBe(true);
    expect(validateSessionStats(valid, [])).toBeUndefined();
  });

  test('accepts the exact upper bound of every field', () => {
    const atMax = {
      progress_pct: LIMITS.SESSION_STATS_MAX_PROGRESS_PCT,
      minutes_elapsed: LIMITS.SESSION_STATS_MAX_MINUTES_ELAPSED,
      task_switches: LIMITS.SESSION_STATS_MAX_TASK_SWITCHES,
      break_count: LIMITS.SESSION_STATS_MAX_BREAK_COUNT,
      current_streak_days: LIMITS.SESSION_STATS_MAX_STREAK_DAYS
    };
    expect(validateCoachPayload({ session_stats: atMax }).valid).toBe(true);
  });

  test('rejects any field one past its bound', () => {
    expect(
      validateCoachPayload({ session_stats: { ...valid, progress_pct: LIMITS.SESSION_STATS_MAX_PROGRESS_PCT + 1 } }).valid
    ).toBe(false);
    expect(
      validateCoachPayload({ session_stats: { ...valid, minutes_elapsed: LIMITS.SESSION_STATS_MAX_MINUTES_ELAPSED + 1 } }).valid
    ).toBe(false);
    expect(
      validateCoachPayload({ session_stats: { ...valid, task_switches: LIMITS.SESSION_STATS_MAX_TASK_SWITCHES + 1 } }).valid
    ).toBe(false);
    expect(
      validateCoachPayload({ session_stats: { ...valid, break_count: LIMITS.SESSION_STATS_MAX_BREAK_COUNT + 1 } }).valid
    ).toBe(false);
    expect(
      validateCoachPayload({ session_stats: { ...valid, current_streak_days: LIMITS.SESSION_STATS_MAX_STREAK_DAYS + 1 } }).valid
    ).toBe(false);
  });

  test('rejects negatives, floats, booleans and unknown fields', () => {
    expect(validateCoachPayload({ session_stats: { ...valid, progress_pct: -1 } }).valid).toBe(false);
    expect(validateCoachPayload({ session_stats: { ...valid, current_streak_days: 1.5 } }).valid).toBe(false);
    expect(validateCoachPayload({ session_stats: { ...valid, break_count: true } }).valid).toBe(false);
    expect(validateCoachPayload({ session_stats: { ...valid, hacked: 1 } }).valid).toBe(false);
    expect(validateCoachPayload({ session_stats: 'nope' }).valid).toBe(false);
  });
});
