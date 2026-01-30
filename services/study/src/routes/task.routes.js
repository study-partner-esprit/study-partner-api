/**
 * Task Routes
 */
const express = require('express');
const { taskController } = require('../controllers');
const { authenticate } = require('../middlewares');

const router = express.Router();

router.get('/', authenticate, taskController.getTasks);
router.get('/due-soon', authenticate, taskController.getDueSoon);
router.get('/overdue', authenticate, taskController.getOverdue);
router.get('/stats', authenticate, taskController.getStats);
router.get('/:taskId', authenticate, taskController.getTask);
router.post('/', authenticate, taskController.createTask);
router.put('/:taskId', authenticate, taskController.updateTask);
router.post('/:taskId/complete', authenticate, taskController.completeTask);
router.delete('/:taskId', authenticate, taskController.deleteTask);

module.exports = router;
