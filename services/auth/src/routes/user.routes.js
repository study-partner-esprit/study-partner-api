/**
 * User Role Routes
 */
const express = require('express');
const { roleController } = require('../controllers');
const {
  authenticate,
  requireAdmin,
  validateAssignRole,
} = require('../middlewares');

const router = express.Router();

/**
 * @route   GET /users/:userId/roles
 * @desc    Get user's roles
 * @access  Private
 */
router.get('/:userId/roles', authenticate, roleController.getUserRoles);

/**
 * @route   POST /users/:userId/roles
 * @desc    Assign role to user
 * @access  Admin
 */
router.post(
  '/:userId/roles',
  authenticate,
  requireAdmin,
  validateAssignRole,
  roleController.assignRole
);

/**
 * @route   DELETE /users/:userId/roles/:roleId
 * @desc    Remove role from user
 * @access  Admin
 */
router.delete(
  '/:userId/roles/:roleId',
  authenticate,
  requireAdmin,
  roleController.removeRole
);

module.exports = router;
