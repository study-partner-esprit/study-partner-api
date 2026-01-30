/**
 * Routes Index
 */
const subjectRoutes = require('./subject.routes');
const sessionRoutes = require('./session.routes');
const taskRoutes = require('./task.routes');
const healthRoutes = require('./health.routes');

module.exports = {
  subjectRoutes,
  sessionRoutes,
  taskRoutes,
  healthRoutes
};
