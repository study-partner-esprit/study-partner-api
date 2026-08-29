const express = require('express');
const { asyncHandler } = require('@study-partner/shared/middleware');
const { validateLearningObjective } = require('../validators/learningObjective');

const router = express.Router();

// POST / — Validate (and, once a LearningObjective persistence model exists,
// create) a learning objective. F01 only specifies the schema/validator;
// persistence isn't in scope here, so this currently validates and echoes
// back the accepted objective. Wire in a model + save once that's defined.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const objective = req.body;
    const result = validateLearningObjective(objective);

    if (!result.valid) {
      // Rejected objectives are never silently dropped — logged for curation,
      // matching this service's existing console.warn/error convention
      // (see subjects.js, tasks.js, sessionTasks.js — none of them use
      // shared/logger.js, so we don't introduce it here either).
      console.warn('LearningObjective rejected:', {
        objectiveId: objective && objective.objectiveId,
        errors: result.errors
      });
      return res.status(400).json({ errors: result.errors });
    }

    res.status(201).json({
      message: 'Learning objective accepted',
      objective
    });
  })
);

module.exports = router;