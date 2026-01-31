/**
 * Shared Utilities Package
 * Common utilities used across all microservices
 */
const loggerModule = require('./logger');
const { ApiError, errorHandler } = require('./errors');
const { validateRequest } = require('./validation');

module.exports = {
  logger: loggerModule,
  createLogger: loggerModule.createLogger,
  ApiError,
  errorHandler,
  validateRequest
};
