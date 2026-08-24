const logger = require('./logger');

module.exports = {
  ...require('./auth'),
  ...require('./cache'),
  ...require('./database'),
  ...require('./middleware'),
  ...require('./processHandlers'),
  ...require('./tierGate'),
  logger
};
