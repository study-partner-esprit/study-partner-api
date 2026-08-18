const seasonService = require('./seasonService');
const leaderboardService = require('./leaderboardService');
const awardService = require('./awardService');

module.exports = { ...seasonService, ...leaderboardService, ...awardService };
