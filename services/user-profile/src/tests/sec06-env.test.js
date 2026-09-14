/**
 * SEC-06 — fail-fast boot-time env validation (requireEnv in shared/env.js).
 *
 * Seeds the required env like every real app.js does, then verifies that a
 * missing / weak required secret calls process.exit(1) with a [FATAL] message
 * while a fully configured env boots without exiting.
 */
process.env.JWT_SECRET = 'test-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.INTERNAL_API_SECRET = 'test-internal-secret';
process.env.NODE_ENV = 'test';

const { requireEnv, logger } = require('@study-partner/shared');

const SAVED_ENV = { ...process.env };
let exitSpy;
let loggerErrorSpy;

beforeEach(() => {
  process.env = { ...SAVED_ENV };
  delete process.env.SEC06_TEST_VAR;
  delete process.env.SEC06_WEAK_VAR;
  process.env.NODE_ENV = 'test';
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  jest.restoreAllMocks();
});

it('exits(1) with a [FATAL] message when a required var is missing', () => {
  requireEnv(['SEC06_TEST_VAR']);
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/\[FATAL\].*SEC06_TEST_VAR/));
});

it('does not exit when all required vars are present (non-prod)', () => {
  process.env.SEC06_TEST_VAR = 'set';
  requireEnv(['SEC06_TEST_VAR']);
  expect(exitSpy).not.toHaveBeenCalled();
});

it('rejects a known insecure default in production', () => {
  process.env.NODE_ENV = 'production';
  process.env.SEC06_WEAK_VAR = 'change-me';
  requireEnv(['SEC06_WEAK_VAR']);
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringMatching(/\[FATAL\].*insecure default/));
});

it('accepts a strong secret in production', () => {
  process.env.NODE_ENV = 'production';
  process.env.SEC06_TEST_VAR = 'a-long-unpredictable-secret';
  requireEnv(['SEC06_TEST_VAR']);
  expect(exitSpy).not.toHaveBeenCalled();
});
