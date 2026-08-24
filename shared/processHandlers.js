/**
 * Process-level fault handlers.
 *
 * Registers `unhandledRejection` and `uncaughtException` handlers so transient
 * errors are logged with context and the process exits cleanly for supervisor
 * restart (Docker restart policy) instead of hanging in an undefined state.
 *
 * Usage: require('@study-partner/shared/processHandlers')('service-name');
 * Call as early as possible in the service entrypoint.
 */
const { logger } = require('./logger');

function registerProcessHandlers(serviceName = 'unknown-service') {
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
      service: serviceName,
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
      promise: String(promise)
    });
    // Exit so the container supervisor restarts a clean process.
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', {
      service: serviceName,
      message: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

module.exports = { registerProcessHandlers };
