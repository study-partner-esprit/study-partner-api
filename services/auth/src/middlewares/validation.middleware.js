/**
 * Request Validation Schemas
 */
const Joi = require('joi');
const { validateRequest } = require('@study-partner/shared-utils');

// Common password requirements
const passwordSchema = Joi.string()
  .min(8)
  .max(128)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .message('Password must be at least 8 characters with uppercase, lowercase, and number');

// Auth schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: passwordSchema.required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

// Role schemas
const createRoleSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  description: Joi.string().max(255)
});

const assignRoleSchema = Joi.object({
  roleId: Joi.number().integer().positive().required()
});

// Export validation middlewares
module.exports = {
  validateRegister: validateRequest(registerSchema),
  validateLogin: validateRequest(loginSchema),
  validateRefresh: validateRequest(refreshSchema),
  validateCreateRole: validateRequest(createRoleSchema),
  validateAssignRole: validateRequest(assignRoleSchema)
};
