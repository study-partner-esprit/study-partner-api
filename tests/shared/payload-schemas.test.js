/**
 * Payload schema tests (F02 / PLAN-02): Node mirror of workers/schemas.py.
 * Limits must match the Python side exactly — contract drift fails CI.
 */

const {
  validateJobPayload,
  validatePlannerPayload,
  validateKnowledgeExtractPayload,
  LIMITS
} = require('../../shared/ai-messaging/payloadSchemas');
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
    expect(validatePlannerPayload({ goal: 'x'.repeat(LIMITS.GOAL_MAX_CHARS + 1) }).valid).toBe(
      false
    );
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
      validatePlannerPayload({ goal: 'g', concepts: ['x'.repeat(LIMITS.CONCEPT_MAX_CHARS + 1)] })
        .valid
    ).toBe(false);
    expect(validatePlannerPayload({ goal: 'g', concepts: [42] }).valid).toBe(false);
  });

  test('rejects bad deadline and available_minutes', () => {
    expect(validatePlannerPayload({ goal: 'g', deadline: 'garbage' }).valid).toBe(false);
    expect(validatePlannerPayload({ goal: 'g', available_minutes: 0 }).valid).toBe(false);
    expect(validatePlannerPayload({ goal: 'g', available_minutes: 1.5 }).valid).toBe(false);
    expect(
      validatePlannerPayload({ goal: 'g', available_minutes: LIMITS.AVAILABLE_MINUTES_MAX + 1 })
        .valid
    ).toBe(false);
  });

  test('rejects non-object payloads', () => {
    expect(validatePlannerPayload('string').valid).toBe(false);
    expect(validatePlannerPayload([1]).valid).toBe(false);
    expect(validatePlannerPayload(null).valid).toBe(false);
  });
});

describe('study.eval.step objectiveId parity (EVAL-08)', () => {
  test('accepts an optional objectiveId', () => {
    expect(
      validateJobPayload('study.eval.step', { sessionId: 's', objectiveId: 'obj-1' }).valid
    ).toBe(true);
  });

  test('rejects a blank objectiveId when provided', () => {
    expect(
      validateJobPayload('study.eval.step', { sessionId: 's', objectiveId: '   ' }).valid
    ).toBe(false);
  });

  test('rejects an over-long objectiveId at the Python limit', () => {
    expect(
      validateJobPayload('study.eval.step', {
        sessionId: 's',
        objectiveId: 'x'.repeat(LIMITS.COURSE_ID_MAX_CHARS + 1)
      }).valid
    ).toBe(false);
  });

  test('eval still requires sessionId', () => {
    expect(validateJobPayload('study.eval.step', { objectiveId: 'obj-1' }).valid).toBe(false);
  });
});

describe('validateJobPayload routing', () => {
  test('knowledge.extract requires documentId, courseId and contentRef (BLOOM-03)', () => {
    expect(
      validateJobPayload('study.knowledge.extract', {
        documentId: 'doc-1',
        courseId: 'c-1',
        contentRef: 's3://bucket/obj'
      }).valid
    ).toBe(true);
    // raw content is never inline — only references are allowed
    expect(validateJobPayload('study.knowledge.extract', {}).valid).toBe(false);
    expect(validateJobPayload('study.knowledge.extract', { documentId: 'doc-1' }).valid).toBe(
      false
    );
    expect(
      validateJobPayload('study.knowledge.extract', { documentId: 'doc-1', courseId: 'c-1' }).valid
    ).toBe(false);
  });

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

describe('validateKnowledgeExtractPayload (BLOOM-03)', () => {
  test('accepts a valid payload with all three references', () => {
    expect(
      validateKnowledgeExtractPayload({
        documentId: 'doc-1',
        courseId: 'c-1',
        contentRef: 'gcs://bucket/obj'
      })
    ).toEqual({ valid: true, errors: [] });
  });

  test('rejects missing or blank references', () => {
    expect(validateKnowledgeExtractPayload({}).valid).toBe(false);
    expect(
      validateKnowledgeExtractPayload({ documentId: 'd', courseId: 'c', contentRef: '' }).valid
    ).toBe(false);
    expect(
      validateKnowledgeExtractPayload({ documentId: '  ', courseId: 'c', contentRef: 'r' }).valid
    ).toBe(false);
    expect(
      validateKnowledgeExtractPayload({ documentId: 'd', courseId: '  ', contentRef: 'r' }).valid
    ).toBe(false);
  });

  test('rejects over-length references and non-objects', () => {
    expect(
      validateKnowledgeExtractPayload({
        documentId: 'x'.repeat(LIMITS.DOCUMENT_ID_MAX_CHARS + 1),
        courseId: 'c',
        contentRef: 'r'
      }).valid
    ).toBe(false);
    expect(
      validateKnowledgeExtractPayload({
        documentId: 'd',
        courseId: 'c',
        contentRef: 'x'.repeat(LIMITS.CONTENT_REF_MAX_CHARS + 1)
      }).valid
    ).toBe(false);
    expect(validateKnowledgeExtractPayload(null).valid).toBe(false);
    expect(validateKnowledgeExtractPayload('str').valid).toBe(false);
    expect(validateKnowledgeExtractPayload([1]).valid).toBe(false);
  });
});
