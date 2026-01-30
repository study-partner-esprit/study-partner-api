/**
 * RBAC Middleware
 * Role-Based Access Control
 */
const { ApiError } = require('@study-partner/shared-utils');

/**
 * Require specific roles
 * @param {...string} allowedRoles - Roles that are allowed
 * @returns {Function} Express middleware
 */
const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }
    
    const userRoles = req.user.roles || [];
    const hasPermission = allowedRoles.some(role => userRoles.includes(role));
    
    if (!hasPermission) {
      return next(ApiError.forbidden(
        `Requires one of the following roles: ${allowedRoles.join(', ')}`
      ));
    }
    
    next();
  };
};

/**
 * Require admin role
 */
const requireAdmin = requireRoles('admin');

/**
 * Require moderator or admin role
 */
const requireModerator = requireRoles('admin', 'moderator');

/**
 * Require the user to be the owner of the resource or admin
 * @param {Function} getResourceUserId - Function to extract user ID from request
 * @returns {Function} Express middleware
 */
const requireOwnerOrAdmin = (getResourceUserId) => {
  return async (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }
    
    const userRoles = req.user.roles || [];
    const isAdmin = userRoles.includes('admin');
    
    if (isAdmin) {
      return next();
    }
    
    try {
      const resourceUserId = await getResourceUserId(req);
      
      if (resourceUserId !== req.user.sub) {
        return next(ApiError.forbidden('Access denied'));
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  requireRoles,
  requireAdmin,
  requireModerator,
  requireOwnerOrAdmin,
};
