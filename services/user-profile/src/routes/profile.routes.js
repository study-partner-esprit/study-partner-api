/**
 * Profile Routes
 */
const express = require('express');
const { profileController } = require('../controllers');
const { authenticate } = require('../middlewares');

const router = express.Router();

router.get('/', authenticate, profileController.getProfile);
router.put('/', authenticate, profileController.updateProfile);
router.post('/onboarding/complete', authenticate, profileController.completeOnboarding);

module.exports = router;
