/**
 * Session Routes
 */
const express = require('express');
const { sessionController } = require('../controllers');
const { authenticate } = require('../middlewares');

const router = express.Router();

router.get('/', authenticate, sessionController.getSessions);
router.get('/active', authenticate, sessionController.getActiveSession);
router.get('/today/stats', authenticate, sessionController.getTodayStats);
router.get('/:sessionId', authenticate, sessionController.getSession);
router.post('/', authenticate, sessionController.createSession);
router.post('/:sessionId/start', authenticate, sessionController.startSession);
router.post('/:sessionId/end', authenticate, sessionController.endSession);
router.post('/:sessionId/cancel', authenticate, sessionController.cancelSession);

module.exports = router;
