/**
 * INGEST-06/07 — AI progress envelope tests.
 * Mirrors `TestProgressEnvelope` in study-partner-ai/tests/test_ai_envelope_contract.py
 * so both sides validate the `progress` routing-key events identically.
 */

const {
  validateAiProgressEnvelope,
  validateAiResultEnvelope,
  PROGRESS_STAGES,
  PROGRESS_STATUS
} = require('../../shared/ai-messaging/envelope');

const VALID_BASE = {
  messageId: 'a40ad024-8492-4cb5-a9a7-6ca2d2bc47c9',
  correlationId: '0f8e2d1a-3b4c-4d6e-8f80-91a2b3c4d5e6',
  type: 'study.ingest.course',
  version: '1',
  userId: 'user-1',
  requestId: 'req-ingest',
  timestamp: '2026-08-19T08:00:00Z'
};

describe('validateAiProgressEnvelope (INGEST-06/07)', () => {
  test.each(PROGRESS_STAGES)('accepts every stage (%s)', (stage) => {
    const check = validateAiProgressEnvelope({
      ...VALID_BASE,
      status: 'progress',
      stage,
      progress: 0.5,
      detail: 'parsing files'
    });
    expect(check.valid).toBe(true);
  });

  test('progress is optional and must be a number in [0, 1]', () => {
    expect(
      validateAiProgressEnvelope({ ...VALID_BASE, status: 'progress', stage: 'parsing' }).valid
    ).toBe(true);
    expect(
      validateAiProgressEnvelope({
        ...VALID_BASE,
        status: 'progress',
        stage: 'parsing',
        progress: 1.5
      }).valid
    ).toBe(false);
    expect(
      validateAiProgressEnvelope({
        ...VALID_BASE,
        status: 'progress',
        stage: 'parsing',
        progress: '0.5'
      }).valid
    ).toBe(false);
  });

  test('rejects an unknown stage', () => {
    const check = validateAiProgressEnvelope({
      ...VALID_BASE,
      status: 'progress',
      stage: 'compiling'
    });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => /stage/.test(e))).toBe(true);
  });

  test('rejects an oversized detail', () => {
    const check = validateAiProgressEnvelope({
      ...VALID_BASE,
      status: 'progress',
      stage: 'parsing',
      detail: 'x'.repeat(300)
    });
    expect(check.valid).toBe(false);
  });

  test('status must be exactly "progress"', () => {
    expect(
      validateAiProgressEnvelope({ ...VALID_BASE, status: 'completed', stage: 'parsing' }).valid
    ).toBe(false);
    expect(validateAiProgressEnvelope({ ...VALID_BASE, stage: 'parsing' }).valid).toBe(false);
  });

  test('progress envelopes must not carry payload/error fields', () => {
    const withPayload = validateAiProgressEnvelope({
      ...VALID_BASE,
      status: 'progress',
      stage: 'embedding',
      payload: {}
    });
    const withError = validateAiProgressEnvelope({
      ...VALID_BASE,
      status: 'progress',
      stage: 'embedding',
      error: 'boom'
    });
    expect(withPayload.valid).toBe(false);
    expect(withError.valid).toBe(false);
  });

  test('requires the common envelope fields', () => {
    const check = validateAiProgressEnvelope({
      ...VALID_BASE,
      status: 'progress',
      stage: 'parsing',
      messageId: 'not-a-uuid'
    });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => /messageId/.test(e))).toBe(true);
  });

  test('result validation still rejects a progress status', () => {
    // Progress lives on its own envelope/key — it must never be usable as a
    // terminal result status (the orchestrator correlates completed/failed).
    expect(validateAiResultEnvelope({ ...VALID_BASE, status: 'progress' }).valid).toBe(false);
  });

  test('PROGRESS_STATUS constant is the canonical literal', () => {
    expect(PROGRESS_STATUS).toBe('progress');
    expect(PROGRESS_STAGES).toEqual(['parsing', 'enriching', 'embedding', 'indexing']);
  });
});
