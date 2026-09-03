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
const DOCUMENT_ID_MAX_CHARS = 64;
const CONTENT_REF_MAX_CHARS = 256;

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

/** SEARCH-02 strict validator for `study.search.query`. Mirrors
 *  workers/schemas.py SearchRequest — limits MUST stay identical on both sides. */
const SEARCH_QUERY_MIN_CHARS = 1;
const SEARCH_QUERY_MAX_CHARS = 500;
const SEARCH_MAX_RESULTS_MIN = 1;
const SEARCH_MAX_RESULTS_MAX = 10;
const SEARCH_MAX_RESULTS_DEFAULT = 5;
const SEARCH_SESSION_ID_MAX_CHARS = 64;

function validateSearchPayload(payload) {
  const errors = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be an object'] };
  }

  // query: required string, 1–500 chars
  const query = payload.query;
  if (typeof query !== 'string') {
    errors.push('query must be a string');
  } else if (query.trim().length < SEARCH_QUERY_MIN_CHARS) {
    errors.push('query must be a non-empty string');
  } else if (query.length > SEARCH_QUERY_MAX_CHARS) {
    errors.push(`query exceeds ${SEARCH_QUERY_MAX_CHARS} chars`);
  }

  // maxResults: optional integer 1–10, default 5
  if (payload.maxResults !== undefined) {
    const n = payload.maxResults;
    if (!Number.isInteger(n) || n < SEARCH_MAX_RESULTS_MIN || n > SEARCH_MAX_RESULTS_MAX) {
      errors.push(
        `maxResults must be an integer between ${SEARCH_MAX_RESULTS_MIN} and ${SEARCH_MAX_RESULTS_MAX}`
      );
    }
  }

  // voiceMode: optional boolean
  if (payload.voiceMode !== undefined && typeof payload.voiceMode !== 'boolean') {
    errors.push('voiceMode must be a boolean');
  }

  // sessionId: optional string, max 64 chars
  if (payload.sessionId !== undefined && payload.sessionId !== null) {
    if (typeof payload.sessionId !== 'string' || !payload.sessionId.trim()) {
      errors.push('sessionId must be a non-empty string when provided');
    } else if (payload.sessionId.length > SEARCH_SESSION_ID_MAX_CHARS) {
      errors.push(`sessionId exceeds ${SEARCH_SESSION_ID_MAX_CHARS} chars`);
    }
  }

  // Reject unknown fields (strict mode)
  const allowed = new Set(['query', 'maxResults', 'voiceMode', 'sessionId']);
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      errors.push(`unknown field "${key}"`);
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

/** Validate the input contract for `study.knowledge.extract` jobs (BLOOM-03). */
function validateKnowledgeExtractPayload(payload) {
  // BLOOM-03: input contract { documentId, courseId, contentRef }. Raw content
  // is loaded from storage by the worker — never inline in the envelope — so
  // only reference fields are required here.
  const errors = [];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be an object'] };
  }

  const documentId = payload.documentId;
  const courseId = payload.courseId;
  const contentRef = payload.contentRef;

  if (
    typeof documentId !== 'string' ||
    !documentId.trim() ||
    documentId.length > DOCUMENT_ID_MAX_CHARS
  ) {
    errors.push(`documentId must be a non-empty string of at most ${DOCUMENT_ID_MAX_CHARS} chars`);
  }
  if (typeof courseId !== 'string' || !courseId.trim() || courseId.length > COURSE_ID_MAX_CHARS) {
    errors.push(`courseId must be a non-empty string of at most ${COURSE_ID_MAX_CHARS} chars`);
  }
  if (
    typeof contentRef !== 'string' ||
    !contentRef.trim() ||
    contentRef.length > CONTENT_REF_MAX_CHARS
  ) {
    errors.push(`contentRef must be a non-empty string of at most ${CONTENT_REF_MAX_CHARS} chars`);
  }

  return { valid: errors.length === 0, errors };
}

const VALIDATORS = {
  'study.plan.generate': validatePlannerPayload,
  'study.coach.nudge': (p) => validateBasicObjectWithFields(p),
  'study.eval.step': validateEvalPayload,
  'study.search.query': validateSearchPayload,
  'study.ingest.course': (p) => validateBasicObjectWithFields(p, ['fileRef']),
  'study.knowledge.extract': validateKnowledgeExtractPayload
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
  validateSearchPayload,
  validateKnowledgeExtractPayload,
  LIMITS: {
    GOAL_MAX_CHARS,
    CONCEPTS_MAX_ITEMS,
    CONCEPT_MAX_CHARS,
    AVAILABLE_MINUTES_MIN,
    AVAILABLE_MINUTES_MAX,
    COURSE_ID_MAX_CHARS,
    DOCUMENT_ID_MAX_CHARS,
    CONTENT_REF_MAX_CHARS,
    SEARCH_QUERY_MIN_CHARS,
    SEARCH_QUERY_MAX_CHARS,
    SEARCH_MAX_RESULTS_MIN,
    SEARCH_MAX_RESULTS_MAX,
    SEARCH_MAX_RESULTS_DEFAULT,
    SEARCH_SESSION_ID_MAX_CHARS
  }
};
