/**
 * Goals Routes
 */
const express = require('express');
const { goalsController } = require('../controllers');
const { authenticate } = require('../middlewares');

const router = express.Router();

router.get('/', authenticate, goalsController.getGoals);
router.get('/stats', authenticate, goalsController.getStats);
router.get('/:goalId', authenticate, goalsController.getGoal);
router.post('/', authenticate, goalsController.createGoal);
router.put('/:goalId', authenticate, goalsController.updateGoal);
router.delete('/:goalId', authenticate, goalsController.deleteGoal);

module.exports = router;
