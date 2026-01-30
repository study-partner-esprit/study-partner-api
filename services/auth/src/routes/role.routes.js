/**
 * Role Routes
 */
const express = require('express');
const { roleController } = require('../controllers');
const { authenticate, requireAdmin, validateCreateRole } = require('../middlewares');

const router = express.Router();

/**
 * @route   GET /roles
 * @desc    Get all roles
 * @access  Private
 */
router.get('/', authenticate, roleController.getAllRoles);

/**
 * @route   POST /roles
 * @desc    Create a new role
 * @access  Admin
 */
router.post('/', authenticate, requireAdmin, validateCreateRole, roleController.createRole);

/**
 * @route   DELETE /roles/:roleId
 * @desc    Delete a role
 * @access  Admin
 */
router.delete('/:roleId', authenticate, requireAdmin, roleController.deleteRole);

module.exports = router;
