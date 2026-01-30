/**
 * Shared Utilities Package
 * Common utilities used across all microservices
 */
const logger = require('./logger');
const { ApiError, errorHandler } = require('./errors');
const { validateRequest } = require('./validation');

module.exports = {
  logger,
  ApiError,
  errorHandler,
  validateRequest
};
