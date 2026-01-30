/**
 * Routes Index
 */
const authRoutes = require('./auth.routes');
const roleRoutes = require('./role.routes');
const userRoutes = require('./user.routes');
const healthRoutes = require('./health.routes');

module.exports = {
  authRoutes,
  roleRoutes,
  userRoutes,
  healthRoutes,
};
