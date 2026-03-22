const express = require('express');
const Joi = require('joi');
const crypto = require('crypto');
// const { hashPassword, verifyPassword, generateToken } = require('@study-partner/shared');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionExpiryNotice
} = require('../services/emailService');
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
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1h'
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
};

const router = express.Router();

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string()
    .pattern(PASSWORD_RULE)
    .message(
      'Password must be at least 8 characters and include uppercase, lowercase, number, and special character'
    )
    .required(),
  name: Joi.string().required(),
  role: Joi.string().valid('student', 'admin').optional(),
  adminKey: Joi.string().optional().allow('')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const verifyOtpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().trim().length(6).pattern(/^\d{6}$/).required()
});

const redeemCouponSchema = Joi.object({
  coupon: Joi.string().trim().min(3).max(100).required(),
  expectedTier: Joi.string().valid('vip', 'vip_plus', 'normal', 'trial').optional()
});

const planChangeSchema = Joi.object({
  newTier: Joi.string().valid('normal', 'vip', 'vip_plus').required(),
  durationMonths: Joi.number().integer().min(1).max(24).default(1)
});

const COUPON_TIER_MAP = {
  'admin@vip': 'vip',
  'admin@vip+': 'vip_plus',
  'admin@vip_plus': 'vip_plus',
  'admin@normal': 'normal',
  'admin@trial': 'trial'
};

function couponsEnabled() {
  if (process.env.ALLOW_TEST_COUPONS === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function resolveTierFromCoupon(rawCoupon) {
  const normalized = String(rawCoupon || '')
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  if (COUPON_TIER_MAP[normalized]) {
    return COUPON_TIER_MAP[normalized];
  }

  // Optional extra coupons from env: COUPON_CODES=code1:vip,code2:vip_plus
  const envCoupons = (process.env.COUPON_CODES || '').split(',');
  for (const entry of envCoupons) {
    const [code, tier] = entry.split(':').map((v) => String(v || '').trim().toLowerCase());
    if (!code || !tier) continue;
    if (normalized === code && ['trial', 'normal', 'vip', 'vip_plus'].includes(tier)) {
      return tier;
    }
  }

  return null;
}

function getSubscriptionSnapshot(user) {
  const now = new Date();
  const endDate = user.subscriptionEndAt ? new Date(user.subscriptionEndAt) : null;
  const hasActiveSubscription =
    !!endDate &&
    endDate > now &&
    ['vip', 'vip_plus'].includes(user.tier);

  const daysRemaining = hasActiveSubscription
    ? Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)))
    : 0;

  const canChangePlan = hasActiveSubscription ? daysRemaining <= 5 : true;
  const daysUntilCanChange = hasActiveSubscription ? Math.max(0, daysRemaining - 5) : 0;

  return {
    hasActiveSubscription,
    daysRemaining,
    canChangePlan,
    daysUntilCanChange
  };
}

function withSubscriptionMeta(user) {
  const safeUser = typeof user.toJSON === 'function' ? user.toJSON() : user;
  return {
    ...safeUser,
    ...getSubscriptionSnapshot(safeUser)
  };
}

// Register
router.post('/register', async (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const { email, password, name, role, adminKey } = req.body;

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
  const requestedRole = role || 'student';
  const userRole = requestedRole === 'admin' ? 'admin' : 'student';

  if (userRole === 'admin') {
    const expectedAdminKey = process.env.ADMIN_REGISTRATION_KEY;
    if (!expectedAdminKey || adminKey !== expectedAdminKey) {
      return res.status(403).json({ error: 'Admin registration is restricted' });
    }
  }

  const verificationOtp = String(Math.floor(100000 + Math.random() * 900000));
  const verificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
  const user = await User.create({
    email,
    password: hashedPassword,
    name,
    role: userRole,
    isAdmin: userRole === 'admin',
    tier: 'trial',
    trialStartedAt: new Date(),
    trialExpiresAt,
    subscriptionStartAt: null,
    subscriptionEndAt: null,
    subscriptionDurationMonths: 0,
    canChangeAfter: null,
    verificationToken,
    verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    verificationOtp,
    verificationOtpExpires
  });

  // Send verification email + OTP (non-blocking)
  sendVerificationEmail(user.email, verificationToken, verificationOtp).catch((err) => {
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
    user: withSubscriptionMeta(user),
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

  if (user.isActive === false) {
    return res.status(403).json({ error: 'Account is deactivated. Please contact support.' });
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
  if (user.role === 'admin' && !user.isAdmin) {
    user.isAdmin = true;
  }
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
    user: withSubscriptionMeta(user),
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
      process.env.JWT_REFRESH_SECRET
    );

    // Fetch fresh user data for up-to-date tier
    const user = await User.findById(decoded.userId);
    const tier = user ? user.tier : decoded.tier || 'normal';
    const role = user ? user.role : decoded.role || 'student';
    const trialExpiresAt = user ? user.trialExpiresAt : decoded.trialExpiresAt;

    // Generate new tokens with current tier
    const newToken = generateToken({
      userId: decoded.userId,
      email: decoded.email,
      role,
      tier,
      trialExpiresAt
    });
    const newRefreshToken = generateRefreshToken({
      userId: decoded.userId,
      email: decoded.email,
      role,
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

  if (
    ['vip', 'vip_plus'].includes(user.tier) &&
    user.subscriptionEndAt &&
    new Date(user.subscriptionEndAt) <= new Date()
  ) {
    user.tier = 'normal';
    user.tierChangedAt = new Date();
    user.subscriptionId = null;
    user.subscriptionStartAt = null;
    user.subscriptionEndAt = null;
    user.subscriptionDurationMonths = 0;
    user.renewalDate = null;
    user.canChangeAfter = null;
    user.autoRenew = false;
    await user.save();
  }

  const snapshot = getSubscriptionSnapshot(user);
  if (
    snapshot.hasActiveSubscription &&
    snapshot.daysRemaining <= 5 &&
    ['vip', 'vip_plus'].includes(user.tier)
  ) {
    const lastNoticeAt = user.subscriptionExpiryNoticeSentAt
      ? new Date(user.subscriptionExpiryNoticeSentAt)
      : null;
    const shouldSendNotice = !lastNoticeAt || Date.now() - lastNoticeAt.getTime() > 24 * 60 * 60 * 1000;

    if (shouldSendNotice) {
      sendSubscriptionExpiryNotice(user.email, {
        tier: user.tier,
        endDate: user.subscriptionEndAt,
        daysRemaining: snapshot.daysRemaining
      }).catch((err) => {
        console.warn('Failed to send subscription expiry reminder:', err.message);
      });
      user.subscriptionExpiryNoticeSentAt = new Date();
      await user.save();
    }
  }

  res.json({ user: withSubscriptionMeta(user) });
});

// Validate and apply manual plan change (used near end-of-cycle windows)
router.post('/plan/change', authenticate, async (req, res) => {
  const { error, value } = planChangeSchema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const snapshot = getSubscriptionSnapshot(user);
  if (snapshot.hasActiveSubscription && !snapshot.canChangePlan) {
    return res.status(403).json({
      error: `Plan change is locked until last 5 days. ${snapshot.daysUntilCanChange} day(s) remaining.`
    });
  }

  user.tier = value.newTier;
  user.tierChangedAt = new Date();

  if (value.newTier === 'normal') {
    user.subscriptionId = null;
    user.subscriptionStartAt = null;
    user.subscriptionEndAt = null;
    user.subscriptionDurationMonths = 0;
    user.renewalDate = null;
    user.canChangeAfter = null;
    user.autoRenew = false;
  } else {
    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setMonth(endAt.getMonth() + value.durationMonths);
    user.subscriptionStartAt = startAt;
    user.subscriptionEndAt = endAt;
    user.subscriptionDurationMonths = value.durationMonths;
    user.renewalDate = endAt;
    user.canChangeAfter = new Date(endAt.getTime() - 5 * 24 * 60 * 60 * 1000);
    user.autoRenew = false;
  }

  await user.save();
  return res.json({ message: 'Plan changed', user: withSubscriptionMeta(user) });
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

  const snapshot = getSubscriptionSnapshot(user);
  if (snapshot.hasActiveSubscription && !snapshot.canChangePlan && user.tier !== tier) {
    return res.status(403).json({
      error: `Plan change is locked until last 5 days. ${snapshot.daysUntilCanChange} day(s) remaining.`
    });
  }

  user.tier = tier;
  user.tierChangedAt = new Date();
  if (tier === 'trial') {
    user.trialStartedAt = new Date();
    user.trialExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  }
  await user.save();

  res.json({ message: 'Tier updated successfully', user: withSubscriptionMeta(user) });
});

// Redeem plan coupon for testing and controlled plan assignment.
router.post('/coupon/redeem', authenticate, async (req, res) => {
  if (!couponsEnabled()) {
    return res.status(403).json({ error: 'Coupon redemption disabled' });
  }

  const { error, value } = redeemCouponSchema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  const targetTier = resolveTierFromCoupon(value.coupon);
  const normalizedCoupon = String(value.coupon || '').trim().toLowerCase();
  const storedCoupon = await Coupon.findOne({ code: normalizedCoupon });

  const resolvedTier = storedCoupon ? storedCoupon.targetTier : targetTier;
  if (!resolvedTier) {
    return res.status(400).json({ error: 'Invalid coupon code' });
  }

  if (value.expectedTier && value.expectedTier !== resolvedTier) {
    return res.status(400).json({
      error: `Coupon is for ${resolvedTier}, but selected plan is ${value.expectedTier}`
    });
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const snapshot = getSubscriptionSnapshot(user);
  if (snapshot.hasActiveSubscription && !snapshot.canChangePlan && user.tier !== resolvedTier) {
    return res.status(403).json({
      error: `Plan change is locked until last 5 days. ${snapshot.daysUntilCanChange} day(s) remaining.`
    });
  }

  if (storedCoupon) {
    const couponCheck = storedCoupon.isRedeemableBy(user._id);
    if (!couponCheck.redeemable) {
      return res.status(400).json({ error: couponCheck.reason || 'Coupon is not redeemable' });
    }
  }

  user.tier = resolvedTier;
  user.tierChangedAt = new Date();
  user.subscriptionId = null;
  user.autoRenew = false;

  if (resolvedTier === 'trial') {
    user.trialStartedAt = new Date();
    user.trialExpiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    user.subscriptionStartAt = null;
    user.subscriptionEndAt = null;
    user.subscriptionDurationMonths = 0;
    user.renewalDate = null;
    user.canChangeAfter = null;
  } else if (resolvedTier === 'normal') {
    user.subscriptionStartAt = null;
    user.subscriptionEndAt = null;
    user.subscriptionDurationMonths = 0;
    user.renewalDate = null;
    user.canChangeAfter = null;
  } else {
    const durationDays = storedCoupon?.durationDays || 30;
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
    user.subscriptionStartAt = startAt;
    user.subscriptionEndAt = endAt;
    user.subscriptionDurationMonths = Math.max(1, Math.round(durationDays / 30));
    user.renewalDate = endAt;
    user.canChangeAfter = new Date(endAt.getTime() - 5 * 24 * 60 * 60 * 1000);
  }

  if (storedCoupon) {
    storedCoupon.usageCount += 1;
    storedCoupon.usedBy.push(user._id);
    storedCoupon.usageHistory.push({ userId: user._id, redeemedAt: new Date() });
    await storedCoupon.save();
  }

  await user.save();

  return res.json({
    message: 'Coupon redeemed successfully',
    tier: user.tier,
    couponExpiresAt: storedCoupon?.expiresAt || user.subscriptionEndAt || null,
    couponDurationDays: storedCoupon?.durationDays || 30,
    user: withSubscriptionMeta(user)
  });
});

// Dev helper to make test coupons discoverable.
router.get('/coupon/list', authenticate, async (req, res) => {
  if (!couponsEnabled()) {
    return res.status(403).json({ error: 'Coupon listing disabled' });
  }

  const envCoupons = (process.env.COUPON_CODES || '')
    .split(',')
    .map((entry) => {
      const [code, tier] = entry.split(':').map((v) => String(v || '').trim());
      if (!code || !tier) return null;
      return { code, tier };
    })
    .filter(Boolean);

  const dbCoupons = await Coupon.find({ isActive: true })
    .select('code targetTier durationDays expiresAt usageCount maxUses')
    .sort({ createdAt: -1 })
    .lean();

  return res.json({
    coupons: [
      { code: 'admin@vip', tier: 'vip' },
      { code: 'admin@vip+', tier: 'vip_plus' },
      { code: 'admin@normal', tier: 'normal' },
      { code: 'admin@trial', tier: 'trial' },
      ...envCoupons,
      ...dbCoupons.map((c) => ({
        code: c.code,
        tier: c.targetTier,
        durationDays: c.durationDays,
        expiresAt: c.expiresAt,
        usageCount: c.usageCount,
        maxUses: c.maxUses
      }))
    ]
  });
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
    user.verificationOtp = undefined;
    user.verificationOtpExpires = undefined;
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
    const verificationOtp = String(Math.floor(100000 + Math.random() * 900000));
    user.verificationToken = token;
    user.verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    user.verificationOtp = verificationOtp;
    user.verificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    await sendVerificationEmail(user.email, token, verificationOtp);
    res.json({ message: 'Verification email sent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// POST /verify-otp — verify a user's email with otp code
router.post('/verify-otp', async (req, res) => {
  try {
    const { error, value } = verifyOtpSchema.validate(req.body || {});
    if (error) return res.status(400).json({ error: error.details[0].message });

    const user = await User.findOne({
      email: value.email.toLowerCase().trim(),
      verificationOtp: value.otp,
      verificationOtpExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    user.verificationOtp = undefined;
    user.verificationOtpExpires = undefined;
    await user.save();

    return res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({ error: 'Failed to verify OTP' });
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

    if (!PASSWORD_RULE.test(newPassword)) {
      return res.status(400).json({
        error:
          'Password must be at least 8 characters and include uppercase, lowercase, number, and special character'
      });
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
