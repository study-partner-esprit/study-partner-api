/**
 * Shared AI messaging utilities (F01 — AI Communication & Job Infrastructure).
 */
module.exports = {
  ...require('./envelope'),
  ...require('./topology'),
  ...require('./publisher')
};
