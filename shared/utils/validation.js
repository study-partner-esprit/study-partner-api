/**
 * Request Validation Middleware
 * Uses Joi for schema validation
 */
const Joi = require('joi');
const { ApiError } = require('./errors');

/**
 * Validate request against Joi schema
 * @param {Object} schema - Joi schema with body, query, params
 * @returns {Function} Express middleware
 */
const validateRequest = (schema) => {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false, // Include all errors
      allowUnknown: true, // Ignore unknown props
      stripUnknown: true // Remove unknown props
    };

    const errors = [];

    // Validate body
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, validationOptions);
      if (error) {
        errors.push(...error.details.map((d) => ({ field: d.path.join('.'), message: d.message })));
      } else {
        req.body = value;
      }
    }

    // Validate query
    if (schema.query) {
      const { error, value } = schema.query.validate(req.query, validationOptions);
      if (error) {
        errors.push(...error.details.map((d) => ({ field: d.path.join('.'), message: d.message })));
      } else {
        req.query = value;
      }
    }

    // Validate params
    if (schema.params) {
      const { error, value } = schema.params.validate(req.params, validationOptions);
      if (error) {
        errors.push(...error.details.map((d) => ({ field: d.path.join('.'), message: d.message })));
      } else {
        req.params = value;
      }
    }

    if (errors.length > 0) {
      const errorMessage = errors.map((e) => `${e.field}: ${e.message}`).join(', ');
      return next(ApiError.badRequest(errorMessage));
    }

    next();
  };
};

module.exports = { validateRequest };
