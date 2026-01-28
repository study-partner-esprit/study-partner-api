const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Apply authentication to all task routes
router.use(authenticateToken);

// Get all tasks
router.get('/', async (req, res) => {
  try {
    // TODO: Implement actual database query
    const tasks = [];
    res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Get task by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // TODO: Implement actual database query
    res.json({
      success: true,
      data: { id, title: 'Sample Task' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Create new task
router.post('/', async (req, res) => {
  try {
    const { title, description, priority } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: { message: 'Title is required' }
      });
    }

    // TODO: Implement actual database insert
    res.status(201).json({
      success: true,
      data: { id: 1, title, description, priority }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Update task
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // TODO: Implement actual database update
    res.json({
      success: true,
      data: { id, ...updates }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

// Delete task
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // TODO: Implement actual database delete
    res.json({
      success: true,
      data: { message: 'Task deleted successfully' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

module.exports = router;
