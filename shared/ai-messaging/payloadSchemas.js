/**
 * Per-type job payload validators (F02 / PLAN-02).
 *
 * Python mirror: `study-partner-ai/workers/schemas.py`. Limits MUST stay
 * identical on both sides — parity is covered by contract tests.
 *
 * Used by the ai-orchestrator jobs route to reject malformed payloads BEFORE
 * publishing (defense at the edge); workers re-validate as defense-in-depth.
 */

const GOAL_MAX_CHARS = 500;
const CONCEPTS_MAX_ITEMS = 50;
const CONCEPT_MAX_CHARS = 100;
const AVAILABLE_MINUTES_MIN = 1;
const AVAILABLE_MINUTES_MAX = 7 * 24 * 60; // one week
const COURSE_ID_MAX_CHARS = 64;

// Coach input limits (COACH-02) — keep in sync with workers/schemas.py
const COACH_SESSION_ID_MAX_CHARS = 64;
const COACH_MAX_SIGNALS = 20;
const COACH_MAX_MESSAGES = 40;
const COACH_MESSAGE_MAX_CHARS = 2000;
const COACH_MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB

// Coach session-stats bounds (COACH-13) — keep in sync with workers/schemas.py
const SESSION_STATS_MAX_PROGRESS_PCT = 100;
const SESSION_STATS_MAX_MINUTES_ELAPSED = 600;
const SESSION_STATS_MAX_TASK_SWITCHES = 50;
const SESSION_STATS_MAX_BREAK_COUNT = 20;
const SESSION_STATS_MAX_STREAK_DAYS = 365;

const SESSION_STATS_FIELDS = [
  'progress_pct',
  'minutes_elapsed',
  'task_switches',
  'break_count',
  'current_streak_days'
];
const SESSION_STATS_BOUNDS = {
  progress_pct: [0, SESSION_STATS_MAX_PROGRESS_PCT],
  minutes_elapsed: [0, SESSION_STATS_MAX_MINUTES_ELAPSED],
  task_switches: [0, SESSION_STATS_MAX_TASK_SWITCHES],
  break_count: [0, SESSION_STATS_MAX_BREAK_COUNT],
  current_streak_days: [0, SESSION_STATS_MAX_STREAK_DAYS]
};

const COACH_FIELDS = new Set([
  'session_id',
  'session_stats',
  'signals',
  'messages',
  'focus_state',
  'focus_score',
  'fatigue_state',
  'fatigue_score',
  'ignored_count',
  'do_not_disturb',
  'current_time'
]);
const FOCUS_STATES = ['Focused', 'Drifting', 'Lost'];
const FATIGUE_STATES = ['Alert', 'Moderate', 'High', 'Critical'];

/** @returns {{valid: boolean, errors: string[]}} */
function validatePlannerPayload(payload) {
  const errors = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be an object'] };
  }

  const goal = payload.goal;
  if (typeof goal !== 'string' || goal.trim().length < 1) {
    errors.push('goal must be a non-empty string');
  } else if (goal.length > GOAL_MAX_CHARS) {
    errors.push(`goal exceeds ${GOAL_MAX_CHARS} chars`);
  }

  if (payload.concepts !== undefined) {
    if (!Array.isArray(payload.concepts)) {
      errors.push('concepts must be an array');
    } else {
      if (payload.concepts.length > CONCEPTS_MAX_ITEMS)
        errors.push(`concepts exceeds ${CONCEPTS_MAX_ITEMS} items`);
      for (const c of payload.concepts) {
        if (typeof c !== 'string' || !c.trim()) {
          errors.push('each concept must be a non-empty string');
          break;
        }
        if (c.length > CONCEPT_MAX_CHARS) {
          errors.push(`concept exceeds ${CONCEPT_MAX_CHARS} chars`);
          break;
        }
      }
    }
  }

  if (payload.courseId !== undefined && payload.courseId !== null) {
    if (typeof payload.courseId !== 'string' || !payload.courseId.trim()) {
      errors.push('courseId must be a non-empty string');
    } else if (payload.courseId.length > COURSE_ID_MAX_CHARS) {
      errors.push(`courseId exceeds ${COURSE_ID_MAX_CHARS} chars`);
    }
  }

  if (payload.deadline !== undefined && payload.deadline !== null) {
    if (
      typeof payload.deadline !== 'string' ||
      Number.isNaN(Date.parse(payload.deadline))
    ) {
      errors.push('deadline must be an ISO 8601 date string');
    }
  }

  if (payload.available_minutes !== undefined) {
    const n = payload.available_minutes;
    if (!Number.isInteger(n) || n < AVAILABLE_MINUTES_MIN || n > AVAILABLE_MINUTES_MAX) {
      errors.push(
        `available_minutes must be an integer between ${AVAILABLE_MINUTES_MIN} and ${AVAILABLE_MINUTES_MAX}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Basic sanity for types whose strict schemas land with their own stories
 *  (COACH-02, EVAL-02, SEARCH-02, INGEST-05). */
function validateBasicObjectWithFields(payload, requiredFields = []) {
  const errors = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be an object'] };
  }
  for (const field of requiredFields) {
    const v = payload[field];
    if (typeof v === 'string') {
      if (!v.trim() || v.length > GOAL_MAX_CHARS) {
        errors.push(`${field} must be a non-empty string of at most ${GOAL_MAX_CHARS} chars`);
      }
    } else if (v === undefined || v === null) {
      errors.push(`${field} is required`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Validate the bounded COACH-13 session_stats block. */
function validateSessionStats(stats, errors, prefix = 'session_stats') {
  if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
    errors.push(`${prefix} must be an object`);
    return;
  }
  for (const key of Object.keys(stats)) {
    if (!SESSION_STATS_FIELDS.includes(key)) {
      errors.push(`${prefix}.${key} is unknown`);
      continue;
    }
    const v = stats[key];
    if (!Number.isInteger(v)) {
      errors.push(`${prefix}.${key} must be an integer`);
      continue;
    }
    const [lo, hi] = SESSION_STATS_BOUNDS[key];
    if (v < lo || v > hi) {
      errors.push(`${prefix}.${key} must be an integer between ${lo} and ${hi}`);
    }
  }
}

/** Bounded CoachRequest validation (COACH-02) — Python mirror workers/schemas.py. */
function validateCoachPayload(payload) {
  const errors = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be an object'] };
  }

  // userId MUST come from the authenticated envelope context, never the body.
  for (const key of Object.keys(payload)) {
    if (!COACH_FIELDS.has(key)) {
      errors.push(`unknown field: ${key}`);
    }
  }

  if (payload.session_id !== undefined && payload.session_id !== null) {
    if (typeof payload.session_id !== 'string' || !payload.session_id.trim()) {
      errors.push('session_id must be a non-empty string');
    } else if (payload.session_id.length > COACH_SESSION_ID_MAX_CHARS) {
      errors.push(`session_id exceeds ${COACH_SESSION_ID_MAX_CHARS} chars`);
    }
  }

  if (payload.session_stats !== undefined && payload.session_stats !== null) {
    validateSessionStats(payload.session_stats, errors);
  }

  if (payload.signals !== undefined) {
    if (!Array.isArray(payload.signals)) {
      errors.push('signals must be an array');
    } else if (payload.signals.length > COACH_MAX_SIGNALS) {
      errors.push(`signals exceeds ${COACH_MAX_SIGNALS} items`);
    } else {
      for (const s of payload.signals) {
        if (typeof s !== 'object' || s === null || Array.isArray(s)) {
          errors.push('each signal must be an object');
          continue;
        }
        if (typeof s.timestamp !== 'string' || Number.isNaN(Date.parse(s.timestamp))) {
          errors.push('signal.timestamp must be an ISO 8601 string');
        }
        if (!FOCUS_STATES.includes(s.focus_state)) {
          errors.push(`signal.focus_state must be one of: ${FOCUS_STATES.join(', ')}`);
        }
        if (!FATIGUE_STATES.includes(s.fatigue_state)) {
          errors.push(`signal.fatigue_state must be one of: ${FATIGUE_STATES.join(', ')}`);
        }
        for (const k of ['focus_score', 'fatigue_score', 'focus_confidence', 'fatigue_confidence']) {
          const v = s[k];
          if (v === undefined || v === null) continue;
          if (typeof v !== 'number' || v < 0 || v > 1) {
            errors.push(`signal.${k} must be a number in [0, 1]`);
          }
        }
        if (s.focus_trend !== undefined && s.focus_trend !== null && typeof s.focus_trend !== 'number') {
          errors.push('signal.focus_trend must be a number');
        }
      }
    }
  }

  if (payload.messages !== undefined) {
    if (!Array.isArray(payload.messages)) {
      errors.push('messages must be an array');
    } else if (payload.messages.length > COACH_MAX_MESSAGES) {
      errors.push(`messages exceeds ${COACH_MAX_MESSAGES} items`);
    } else {
      for (const m of payload.messages) {
        if (typeof m !== 'object' || m === null || Array.isArray(m)) {
          errors.push('each message must be an object');
          continue;
        }
        if (m.role !== 'user' && m.role !== 'assistant') {
          errors.push('message.role must be user or assistant');
        }
        const c = m.content;
        if (typeof c !== 'string' || !c.trim()) {
          errors.push('message.content must be a non-empty string');
        } else if (c.length > COACH_MESSAGE_MAX_CHARS) {
          errors.push(`message.content exceeds ${COACH_MESSAGE_MAX_CHARS} chars`);
        }
      }
    }
  }

  for (const [k, states] of [['focus_state', FOCUS_STATES], ['fatigue_state', FATIGUE_STATES]]) {
    const v = payload[k];
    if (v !== undefined && v !== null && !states.includes(v)) {
      errors.push(`${k} must be one of: ${states.join(', ')}`);
    }
  }
  for (const k of ['focus_score', 'fatigue_score']) {
    const v = payload[k];
    if (v !== undefined && v !== null && (typeof v !== 'number' || v < 0 || v > 1)) {
      errors.push(`${k} must be a number in [0, 1]`);
    }
  }
  if (payload.ignored_count !== undefined && (!Number.isInteger(payload.ignored_count) || payload.ignored_count < 0)) {
    errors.push('ignored_count must be an integer >= 0');
  }
  if (payload.do_not_disturb !== undefined && typeof payload.do_not_disturb !== 'boolean') {
    errors.push('do_not_disturb must be a boolean');
  }
  if (
    payload.current_time !== undefined && payload.current_time !== null &&
    (typeof payload.current_time !== 'string' || Number.isNaN(Date.parse(payload.current_time)))
  ) {
    errors.push('current_time must be an ISO 8601 string');
  }

  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > COACH_MAX_PAYLOAD_BYTES) {
    errors.push(`payload exceeds ${COACH_MAX_PAYLOAD_BYTES} bytes (got ${size})`);
  }

  return { valid: errors.length === 0, errors };
}

const VALIDATORS = {
  'study.plan.generate': validatePlannerPayload,
  'study.coach.nudge': validateCoachPayload,
  'study.eval.step': (p) => validateBasicObjectWithFields(p, ['sessionId']),
  'study.search.query': (p) => validateBasicObjectWithFields(p, ['query']),
  'study.ingest.course': (p) => validateBasicObjectWithFields(p, ['fileRef'])
};

/** Validate a job payload for the given type. Unknown types pass through. */
function validateJobPayload(type, payload) {
  const validator = VALIDATORS[type];
  if (!validator) return { valid: true, errors: [] };
  return validator(payload);
}

module.exports = {
  validateJobPayload,
  validatePlannerPayload,
  validateCoachPayload,
  validateSessionStats,
  LIMITS: {
    GOAL_MAX_CHARS,
    CONCEPTS_MAX_ITEMS,
    CONCEPT_MAX_CHARS,
    AVAILABLE_MINUTES_MIN,
    AVAILABLE_MINUTES_MAX,
    COURSE_ID_MAX_CHARS,
    COACH_SESSION_ID_MAX_CHARS,
    COACH_MAX_SIGNALS,
    COACH_MAX_MESSAGES,
    COACH_MESSAGE_MAX_CHARS,
    COACH_MAX_PAYLOAD_BYTES,
    SESSION_STATS_MAX_PROGRESS_PCT,
    SESSION_STATS_MAX_MINUTES_ELAPSED,
    SESSION_STATS_MAX_TASK_SWITCHES,
    SESSION_STATS_MAX_BREAK_COUNT,
    SESSION_STATS_MAX_STREAK_DAYS
  }
};
