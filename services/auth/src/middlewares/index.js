/**
 * Middlewares Index
 */
const { authenticate, optionalAuth } = require('./auth.middleware');
const {
  requireRoles,
  requireAdmin,
  requireModerator,
  requireOwnerOrAdmin
} = require('./rbac.middleware');
const validation = require('./validation.middleware');

module.exports = {
  authenticate,
  optionalAuth,
  requireRoles,
  requireAdmin,
  requireModerator,
  requireOwnerOrAdmin,
  ...validation
};
