/**
 * Boot-time environment validation.
 *
 * Call as early as possible in each service's app.js so the process exits
 * immediately with a clear [FATAL] message when required configuration is
 * missing or insecure defaults are detected in production.
 *
 * Usage:
 *   const { requireEnv } = require('@study-partner/shared');
 *   requireEnv(['JWT_SECRET', 'MONGODB_URI']);
 */
const logger = require('./logger');

const INSECURE_DEFAULTS = [
  'your-super-secret-jwt-key-change-in-production',
  'your-secret-key',
  'change-me',
  'change-this-refresh-secret',
  'replace_with_a_strong_secret'
];

/**
 * @param {string[]} keys         — Env-var names that must be set and non-empty.
 * @param {object}   [opts]
 * @param {string}   [opts.serviceName]        — Human label in the error line.
 * @param {string[]} [opts.insecureDefaults]   — Strings to reject when
 *                                               NODE_ENV=production.  Falls
 *                                               back to INSECURE_DEFAULTS.
 */
function requireEnv(keys, { serviceName, insecureDefaults = INSECURE_DEFAULTS } = {}) {
  const tag = serviceName ? `[${serviceName}] ` : '';

  for (const key of keys) {
    if (!process.env[key]) {
      logger.error(`${tag}[FATAL] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    for (const key of keys) {
      if (insecureDefaults.includes(process.env[key])) {
        logger.error(
          `${tag}[FATAL] ${key} is set to an insecure default. Set a real secret before running in production.`
        );
        process.exit(1);
      }
    }
  }
}

module.exports = { requireEnv };
