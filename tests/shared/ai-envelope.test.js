const {
  ENVELOPE_VERSION,
  AI_JOB_TYPES,
  validateAiJobEnvelope,
  validateAiResultEnvelope
} = require('../../shared/ai-messaging/envelope');

const UUID_A = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const UUID_B = '0f8e2d1a-3b4c-4d6e-8f80-91a2b3c4d5e6';

const validBase = {
  messageId: UUID_A,
  correlationId: UUID_B,
  type: 'study.plan.generate',
  version: ENVELOPE_VERSION,
  requestId: 'req-abc123',
  timestamp: new Date().toISOString()
};

describe('AI job envelope (AI-COM-02)', () => {
  test('accepts a well-formed job envelope', () => {
    const { valid, errors } = validateAiJobEnvelope({
      ...validBase,
      userId: 'user-1',
      payload: { goal: 'learn graphs' }
    });
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  test('rejects unknown type', () => {
    const { valid } = validateAiJobEnvelope({
      ...validBase,
      type: 'study.plan.delete-everything',
      userId: 'user-1',
      payload: {}
    });
    expect(valid).toBe(false);
  });

  test('rejects missing/invalid userId (must come from auth context)', () => {
    for (const userId of [undefined, '', null, 'x'.repeat(200)]) {
      expect(
        validateAiJobEnvelope({ ...validBase, userId, payload: {} }).valid
      ).toBe(false);
    }
  });

  test('rejects non-object payload', () => {
    expect(validateAiJobEnvelope({ ...validBase, userId: 'u', payload: [1] }).valid).toBe(false);
    expect(validateAiJobEnvelope({ ...validBase, userId: 'u', payload: 'str' }).valid).toBe(false);
  });

  test('rejects wrong version and malformed ids', () => {
    expect(
      validateAiJobEnvelope({ ...validBase, version: '2', userId: 'u', payload: {} }).valid
    ).toBe(false);
    expect(
      validateAiJobEnvelope({ ...validBase, messageId: 'not-a-uuid', userId: 'u', payload: {} }).valid
    ).toBe(false);
  });

  test('rejects status/error/result fields on jobs', () => {
    const { valid } = validateAiJobEnvelope({
      ...validBase,
      userId: 'u',
      payload: {},
      status: 'PENDING'
    });
    expect(valid).toBe(false);
  });

  test('covers all registered job types', () => {
    for (const type of AI_JOB_TYPES) {
      expect(
        validateAiJobEnvelope({ ...validBase, type, userId: 'u', payload: {} }).valid
      ).toBe(true);
    }
  });
});

describe('AI result envelope (AI-COM-03)', () => {
  test('accepts completed result with payload and no error', () => {
    const { valid } = validateAiResultEnvelope({
      ...validBase,
      status: 'completed',
      payload: { plan: [] }
    });
    expect(valid).toBe(true);
  });

  test('accepts sanitized failed result', () => {
    const { valid } = validateAiResultEnvelope({
      ...validBase,
      status: 'failed',
      error: 'LLM provider timeout after retries'
    });
    expect(valid).toBe(true);
  });

  test('rejects stack traces / connection strings in error (audit §7.5)', () => {
    const leaky = [
      'Error: x\n    at handler (/app/src/x.js:10:5)',
      'auth failed: mongodb://admin:s3cret@mongo:27017',
      'mongodb+srv://user:pass@cluster.example.net/db'
    ];
    for (const error of leaky) {
      expect(validateAiResultEnvelope({ ...validBase, status: 'failed', error }).valid).toBe(false);
    }
  });

  test('failed results require an error message within limits', () => {
    expect(validateAiResultEnvelope({ ...validBase, status: 'failed' }).valid).toBe(false);
    expect(
      validateAiResultEnvelope({ ...validBase, status: 'failed', error: 'x'.repeat(600) }).valid
    ).toBe(false);
  });

  test('completed results must not carry an error field', () => {
    const { valid } = validateAiResultEnvelope({
      ...validBase,
      status: 'completed',
      payload: {},
      error: 'should not be here'
    });
    expect(valid).toBe(false);
  });
});
