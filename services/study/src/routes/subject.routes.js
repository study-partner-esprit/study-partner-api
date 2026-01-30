/**
 * Subject Routes
 */
const express = require('express');
const { subjectController } = require('../controllers');
const { authenticate } = require('../middlewares');

const router = express.Router();

router.get('/', authenticate, subjectController.getSubjects);
router.get('/:subjectId', authenticate, subjectController.getSubject);
router.get('/:subjectId/stats', authenticate, subjectController.getSubjectStats);
router.post('/', authenticate, subjectController.createSubject);
router.put('/:subjectId', authenticate, subjectController.updateSubject);
router.delete('/:subjectId', authenticate, subjectController.deleteSubject);

module.exports = router;
