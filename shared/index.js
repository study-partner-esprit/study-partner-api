const logger = require('./logger');

module.exports = {
  ...require('./auth'),
  ...require('./database'),
  ...require('./middleware'),
  logger,
};
