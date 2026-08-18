const express = require('express');
const router = express.Router();

const core = require('./coreSessions');
const challenge = require('./challengeSessions');
const tasks = require('./sessionTasks');
const team = require('./teamSessions');

router.use('/', core);
router.use('/', challenge);
router.use('/', tasks);
router.use('/', team);

module.exports = router;
