const express = require('express');
const Joi = require('joi');
const crypto = require('crypto');
// const { hashPassword, verifyPassword, generateToken } = require('@study-partner/shared');
const User = require('../models/User');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const { authenticate } = require('@study-partner/shared/auth');

// Temporary implementations until shared package is fixed
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h'
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key', {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
};

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  name: Joi.string().required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Register
router.post('/register', async (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { email, password, name } = req.body;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ error: 'User already exists' });
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user with trial tier
  const trialExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const user = await User.create({
    email,
    password: hashedPassword,
    name,
    tier: 'trial',
    trialStartedAt: new Date(),
    trialExpiresAt,
    verificationToken,
    verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
  });

  // Send verification email (non-blocking)
  sendVerificationEmail(user.email, verificationToken).catch((err) => {
    console.warn('Failed to send verification email:', err.message);
  });

  // Generate tokens (include tier in JWT payload)
  const token = generateToken({
    userId: user._id,
    email: user.email,
    role: user.role,
    tier: user.tier,
    trialExpiresAt: user.trialExpiresAt
  });
  const refreshToken = generateRefreshToken({
    userId: user._id,
    email: user.email,
    role: user.role,
    tier: user.tier,
    trialExpiresAt: user.trialExpiresAt
  });

  res.status(201).json({
    message: 'User registered successfully',
    user: user.toJSON(),
    token,
    refreshToken
  });
});

// Login
router.post('/login', async (req, res) => {
  const { error } = loginSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { email, password } = req.body;

  // Find user
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Verify password
  const isValid = await verifyPassword(password, user.password);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Auto-downgrade expired trials
  if (user.tier === 'trial' && user.trialExpiresAt && new Date(user.trialExpiresAt) < new Date()) {
    user.tier = 'normal';
    user.tierChangedAt = new Date();
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate tokens (include tier in JWT payload)
  const token = generateToken({
    userId: user._id,
    email: user.email,
    role: user.role,
    tier: user.tier,
    trialExpiresAt: user.trialExpiresAt
  });
  const refreshToken = generateRefreshToken({
    userId: user._id,
    email: user.email,
    role: user.role,
    tier: user.tier,
    trialExpiresAt: user.trialExpiresAt
  });

  res.json({
    message: 'Login successful',
    user: user.toJSON(),
    token,
    refreshToken
  });
});

// Refresh token
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key'
    );

    // Fetch fresh user data for up-to-date tier
    const user = await User.findById(decoded.userId);
    const tier = user ? user.tier : decoded.tier || 'normal';
    const trialExpiresAt = user ? user.trialExpiresAt : decoded.trialExpiresAt;

    // Generate new tokens with current tier
    const newToken = generateToken({
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tier,
      trialExpiresAt
    });
    const newRefreshToken = generateRefreshToken({
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      tier,
      trialExpiresAt
    });

    res.json({
      token: newToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Get current user (protected route)
router.get('/me', authenticate, async (req, res) => {
  // User is attached to req by authenticate middleware
  const user = await User.findById(req.user.userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Auto-downgrade expired trials
  if (user.tier === 'trial' && user.trialExpiresAt && new Date(user.trialExpiresAt) < new Date()) {
    user.tier = 'normal';
    user.tierChangedAt = new Date();
    await user.save();
  }

  res.json({ user: user.toJSON() });
});

// Update user tier (admin or payment webhook)
router.put('/tier', authenticate, async (req, res) => {
  const { tier } = req.body;
  const validTiers = ['trial', 'normal', 'vip', 'vip_plus'];
  if (!tier || !validTiers.includes(tier)) {
    return res
      .status(400)
      .json({ error: 'Invalid tier. Must be one of: trial, normal, vip, vip_plus' });
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  user.tier = tier;
  user.tierChangedAt = new Date();
  if (tier === 'trial') {
    user.trialStartedAt = new Date();
    user.trialExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  }
  await user.save();

  res.json({ message: 'Tier updated successfully', user: user.toJSON() });
});

// ==================== Email Verification ====================

// POST /verify-email — verify a user's email with token
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const user = await User.findOne({
      verificationToken: token,
      verificationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// POST /resend-verification — resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isVerified) return res.json({ message: 'Email already verified' });

    const token = crypto.randomBytes(32).toString('hex');
    user.verificationToken = token;
    user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await user.save();

    await sendVerificationEmail(user.email, token);
    res.json({ message: 'Verification email sent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// ==================== Password Reset ====================

// POST /forgot-password — request a password reset link
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ message: 'If an account exists, a reset link has been sent' });

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    await sendPasswordResetEmail(user.email, token);
    res.json({ message: 'If an account exists, a reset link has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /reset-password — set new password using token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    user.password = await hashPassword(newPassword);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    // Clear all refresh tokens for security
    user.refreshTokens = [];
    await user.save();

    res.json({ message: 'Password reset successfully. Please log in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
