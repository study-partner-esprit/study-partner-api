/**
 * Logger Utility
 * Winston-based logging with multiple transports
 */
const winston = require('winston');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack, service }) => {
  const svc = service ? `[${service}]` : '';
  return `${timestamp} ${svc} [${level}]: ${stack || message}`;
});

/**
 * Create a logger instance for a specific service
 * @param {string} serviceName - Name of the service
 * @returns {winston.Logger}
 */
const createLogger = (serviceName = 'api') => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
      timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      errors({ stack: true }),
      logFormat
    ),
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.Console({
        format: combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat)
      })
    ]
  });

  // Add file transports in production
  if (process.env.NODE_ENV === 'production') {
    logger.add(
      new winston.transports.File({
        filename: `logs/${serviceName}-error.log`,
        level: 'error',
        maxsize: 5242880,
        maxFiles: 5
      })
    );
    logger.add(
      new winston.transports.File({
        filename: `logs/${serviceName}-combined.log`,
        maxsize: 5242880,
        maxFiles: 5
      })
    );
  }

  return logger;
};

// Default logger
module.exports = createLogger();
module.exports.createLogger = createLogger;
