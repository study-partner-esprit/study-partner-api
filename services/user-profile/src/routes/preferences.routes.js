/**
 * Preferences Routes
 */
const express = require('express');
const { preferencesController } = require('../controllers');
const { authenticate } = require('../middlewares');

const router = express.Router();

router.get('/', authenticate, preferencesController.getPreferences);
router.put('/', authenticate, preferencesController.updatePreferences);
router.post('/reset', authenticate, preferencesController.resetPreferences);

module.exports = router;
