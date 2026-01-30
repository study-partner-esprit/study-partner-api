/**
 * Auth Routes
 */
const express = require('express');
const { authController } = require('../controllers');
const { 
  authenticate, 
  validateRegister, 
  validateLogin, 
  validateRefresh,
} = require('../middlewares');

const router = express.Router();

/**
 * @route   POST /auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', validateRegister, authController.register);

/**
 * @route   POST /auth/login
 * @desc    Login user and get tokens
 * @access  Public
 */
router.post('/login', validateLogin, authController.login);

/**
 * @route   POST /auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh', validateRefresh, authController.refreshToken);

/**
 * @route   POST /auth/logout
 * @desc    Logout user (invalidate refresh token)
 * @access  Public
 */
router.post('/logout', authController.logout);

/**
 * @route   POST /auth/logout-all
 * @desc    Logout from all devices
 * @access  Private
 */
router.post('/logout-all', authenticate, authController.logoutAll);

/**
 * @route   GET /auth/me
 * @desc    Get current user info
 * @access  Private
 */
router.get('/me', authenticate, authController.me);

module.exports = router;
