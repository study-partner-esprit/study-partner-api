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
    if (typeof payload.deadline !== 'string' || Number.isNaN(Date.parse(payload.deadline))) {
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

/** eval (F04 / EVAL-08): optional objectiveId matches the Python mirror —
 *  blank/over-length values are rejected, absent is fine. */
function validateEvalPayload(payload) {
  const base = validateBasicObjectWithFields(payload, ['sessionId']);
  const errors = [...base.errors];
  if (payload.objectiveId !== undefined && payload.objectiveId !== null) {
    if (typeof payload.objectiveId !== 'string' || !payload.objectiveId.trim()) {
      errors.push('objectiveId must be a non-empty string when provided');
    } else if (payload.objectiveId.length > COURSE_ID_MAX_CHARS) {
      errors.push(`objectiveId exceeds ${COURSE_ID_MAX_CHARS} chars`);
    }
  }
  return { valid: errors.length === 0, errors };
}

const VALIDATORS = {
  'study.plan.generate': validatePlannerPayload,
  'study.coach.nudge': (p) => validateBasicObjectWithFields(p),
  'study.eval.step': validateEvalPayload,
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
  LIMITS: {
    GOAL_MAX_CHARS,
    CONCEPTS_MAX_ITEMS,
    CONCEPT_MAX_CHARS,
    AVAILABLE_MINUTES_MIN,
    AVAILABLE_MINUTES_MAX,
    COURSE_ID_MAX_CHARS
  }
};
