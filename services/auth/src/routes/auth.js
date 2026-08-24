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
const { authenticate, hashRefreshToken } = require('@study-partner/shared/auth');
const { asyncHandler } = require('@study-partner/shared/middleware');

// Temporary implementations until shared package is fixed
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

const generateOtp = (length = 6) => {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(crypto.randomInt(min, max + 1));
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
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
};

const router = express.Router();

// Prune expired refresh tokens from the array (called before any push)
const pruneExpiredTokens = (tokens) => {
  const now = new Date();
  return (tokens || []).filter((t) => t.expiresAt && t.expiresAt > now);
};

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
const onboardingSchema = Joi.object({
  studyGoals: Joi.array().items(Joi.string().trim().min(2).max(80)).max(10).optional(),
  preferredSubjects: Joi.array().items(Joi.string().trim().min(2).max(80)).max(20).optional(),
  weeklyHours: Joi.number().min(0).max(120).optional(),
  studyLevel: Joi.string().valid('beginner', 'intermediate', 'advanced').optional(),
  studyTime: Joi.string().valid('morning', 'afternoon', 'evening', 'night').optional(),
  timezone: Joi.string().trim().max(100).optional(),
  language: Joi.string().trim().max(20).optional(),
  notificationPreferences: Joi.object({
    email: Joi.boolean().optional(),
    push: Joi.boolean().optional()
  }).optional()
}).optional();

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
  onboarding: onboardingSchema,
  role: Joi.string().valid('student', 'admin').optional(),
  adminKey: Joi.string().optional().allow('')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const verifyOtpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string()
    .trim()
    .length(6)
    .pattern(/^\d{6}$/)
    .required()
});

const redeemCouponSchema = Joi.object({
  coupon: Joi.string().trim().min(3).max(100).required(),
  expectedTier: Joi.string().valid('vip', 'vip_plus', 'normal', 'trial').optional()
});

function normalizeOnboardingDraft(input = {}) {
  const cleaned = {
    studyGoals: Array.isArray(input.studyGoals)
      ? input.studyGoals
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 10)
      : [],
    preferredSubjects: Array.isArray(input.preferredSubjects)
      ? input.preferredSubjects
          .map((item) => String(item).trim())
          .filter(Boolean)
          .slice(0, 20)
      : [],
    weeklyHours: Number.isFinite(input.weeklyHours) ? Number(input.weeklyHours) : 0,
    studyLevel: ['beginner', 'intermediate', 'advanced'].includes(input.studyLevel)
      ? input.studyLevel
      : 'beginner',
    studyTime: ['morning', 'afternoon', 'evening', 'night'].includes(input.studyTime)
      ? input.studyTime
      : 'evening',
    timezone: String(input.timezone || 'UTC').trim() || 'UTC',
    language: String(input.language || 'en').trim() || 'en',
    notificationPreferences: {
      email:
        typeof input.notificationPreferences?.email === 'boolean'
          ? input.notificationPreferences.email
          : true,
      push:
        typeof input.notificationPreferences?.push === 'boolean'
          ? input.notificationPreferences.push
          : true
    }
  };

  if (!Number.isFinite(cleaned.weeklyHours) || cleaned.weeklyHours < 0) {
    cleaned.weeklyHours = 0;
  }
  if (cleaned.weeklyHours > 120) {
    cleaned.weeklyHours = 120;
  }

  return cleaned;
}

// Test coupons (env-var COUPON_CODES) are a DEVELOPMENT-only convenience.
// They are never honored in production. Coupons stored in the database by
// admins are always eligible and are NOT gated by this flag.
function testCouponsEnabled() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ALLOW_TEST_COUPONS !== 'false';
}

function resolveTestTierFromCoupon(rawCoupon) {
  if (!testCouponsEnabled()) return null;

  const normalized = String(rawCoupon || '')
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  // Optional extra coupons from env: COUPON_CODES=code1:vip,code2:vip_plus
  const envCoupons = (process.env.COUPON_CODES || '').split(',');
  for (const entry of envCoupons) {
    const [code, tier] = entry.split(':').map((v) =>
      String(v || '')
        .trim()
        .toLowerCase()
    );
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
    !!endDate && endDate > now && ['vip', 'vip_plus'].includes(user.tier);

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
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { error } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password, name, role, adminKey, onboarding } = req.body;
    const normalizedEmail = String(email).toLowerCase().trim();

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
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

    const verificationOtp = generateOtp();
    const verificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    const user = await User.create({
      email: normalizedEmail,
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
      onboardingDraft: normalizeOnboardingDraft(onboarding || {}),
      verificationToken,
      verificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      verificationOtp,
      verificationOtpExpires
    });

    // Send verification email + OTP (non-blocking)
    sendVerificationEmail(user.email, verificationToken, verificationOtp).catch((err) => {
      console.warn('Failed to send verification email:', err.message);
    });

    res.status(201).json({
      message: 'Registration successful. Please verify your email to continue.',
      requiresVerification: true,
      verification: {
        email: user.email,
        otpExpiresInMinutes: 10,
        linkExpiresInHours: 24
      },
      user: withSubscriptionMeta(user)
    });
  })
);

// Login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { error } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = req.body;
    const normalizedEmail = String(email).toLowerCase().trim();

    // Find user
    const user = await User.findOne({ email: normalizedEmail });
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

    if (!user.isVerified) {
      return res.status(403).json({
        error: 'Email is not verified. Please verify your email first.',
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email
      });
    }

    // Auto-downgrade expired trials
    if (
      user.tier === 'trial' &&
      user.trialExpiresAt &&
      new Date(user.trialExpiresAt) < new Date()
    ) {
      user.tier = 'normal';
      user.tierChangedAt = new Date();
    }

    // Update last login
    if (user.role === 'admin' && !user.isAdmin) {
      user.isAdmin = true;
    }
    user.lastLogin = new Date();
    await user.save();

    // Generate tokens (include tier and isActive in JWT payload)
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
      tier: user.tier,
      isActive: user.isActive,
      trialExpiresAt: user.trialExpiresAt
    });
    const refreshToken = generateRefreshToken({
      userId: user._id,
      email: user.email,
      role: user.role,
      tier: user.tier,
      isActive: user.isActive,
      trialExpiresAt: user.trialExpiresAt
    });

    // Persist refresh token hash for rotation / revocation
    try {
      const decoded = jwt.decode(refreshToken);
      user.refreshTokens = pruneExpiredTokens(user.refreshTokens);
      user.refreshTokens.push({
        tokenHash: hashRefreshToken(refreshToken),
        jti: decoded.jti,
        expiresAt: new Date(decoded.exp * 1000)
      });
      // Keep at most 5 active refresh tokens (prune oldest)
      if (user.refreshTokens.length > 5) {
        user.refreshTokens = user.refreshTokens.slice(-5);
      }
      await user.save();
    } catch (err) {
      // Token persistence is best-effort; login still succeeds if DB write fails
      console.warn('Failed to persist refresh token:', err.message);
    }

    res.cookie('accessToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
      path: '/'
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });
    res.json({
      message: 'Login successful',
      user: withSubscriptionMeta(user)
    });
  })
);

// Refresh token — single-use rotation with reuse detection
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

      // Fetch fresh user data for up-to-date tier and active state
      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      if (user.isActive === false) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      const tokenHash = hashRefreshToken(refreshToken);
      const tokenIndex = user.refreshTokens.findIndex((t) => t.tokenHash === tokenHash);

      if (tokenIndex === -1) {
        // Token reuse detected — the token was already used or never existed.
        // Revoke ALL refresh tokens for this user to contain a potential breach.
        user.refreshTokens = [];
        await user.save();
        console.warn(
          `Refresh token reuse detected for user ${decoded.userId} — all tokens revoked`
        );
        return res.status(401).json({ error: 'Refresh token revoked' });
      }

      // Remove the used token (single-use)
      user.refreshTokens.splice(tokenIndex, 1);

      const tier = user.tier || decoded.tier || 'normal';
      const role = user.role || decoded.role || 'student';
      const trialExpiresAt = user.trialExpiresAt || decoded.trialExpiresAt;

      // Generate new tokens with current user state
      const newToken = generateToken({
        userId: decoded.userId,
        email: decoded.email,
        role,
        tier,
        isActive: user.isActive,
        trialExpiresAt
      });
      const newRefreshToken = generateRefreshToken({
        userId: decoded.userId,
        email: decoded.email,
        role,
        tier,
        isActive: user.isActive,
        trialExpiresAt
      });

      // Store the new refresh token hash
      try {
        const newDecoded = jwt.decode(newRefreshToken);
        user.refreshTokens = pruneExpiredTokens(user.refreshTokens);
        user.refreshTokens.push({
          tokenHash: hashRefreshToken(newRefreshToken),
          jti: newDecoded.jti,
          expiresAt: new Date(newDecoded.exp * 1000)
        });
        if (user.refreshTokens.length > 5) {
          user.refreshTokens = user.refreshTokens.slice(-5);
        }
      } catch (err) {
        console.warn('Failed to persist rotated refresh token:', err.message);
      }

      await user.save();

      res.cookie('accessToken', newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000,
        path: '/'
      });
      res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/'
      });
      res.json({ message: 'Token refreshed' });
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  })
);

// Logout — revoke a refresh token (or all for the user)
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const tokenFromBody = req.body && req.body.refreshToken;
    const tokenFromCookie = req.cookies && req.cookies.refreshToken;
    const refreshToken = tokenFromBody || tokenFromCookie;
    const all = req.body && req.body.all;

    if (!refreshToken) {
      // Still clear cookies even if no token to revoke
      res.clearCookie('accessToken', { path: '/' });
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(204).send();
    }

    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      const user = await User.findById(decoded.userId);
      if (!user) {
        res.clearCookie('accessToken', { path: '/' });
        res.clearCookie('refreshToken', { path: '/' });
        return res.status(204).send();
      }

      if (all) {
        user.refreshTokens = [];
      } else {
        const tokenHash = hashRefreshToken(refreshToken);
        user.refreshTokens = (user.refreshTokens || []).filter((t) => t.tokenHash !== tokenHash);
      }

      await user.save();
      res.clearCookie('accessToken', { path: '/' });
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(204).send();
    } catch (error) {
      // Always succeed — logout is best-effort
      res.clearCookie('accessToken', { path: '/' });
      res.clearCookie('refreshToken', { path: '/' });
      return res.status(204).send();
    }
  })
);

// Get current user (protected route)
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    // User is attached to req by authenticate middleware
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Auto-downgrade expired trials
    if (
      user.tier === 'trial' &&
      user.trialExpiresAt &&
      new Date(user.trialExpiresAt) < new Date()
    ) {
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
      const shouldSendNotice =
        !lastNoticeAt || Date.now() - lastNoticeAt.getTime() > 24 * 60 * 60 * 1000;

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
  })
);

// Redeem plan coupon for controlled plan assignment.
// DB coupons (admin-created) are always eligible; env-var test coupons only in dev.
router.post(
  '/coupon/redeem',
  authenticate,
  asyncHandler(async (req, res) => {
    const { error, value } = redeemCouponSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const normalizedCoupon = String(value.coupon || '')
      .trim()
      .toLowerCase();
    const storedCoupon = await Coupon.findOne({ code: normalizedCoupon });

    const resolvedTier = storedCoupon
      ? storedCoupon.targetTier
      : resolveTestTierFromCoupon(value.coupon);
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
  })
);

// Dev helper to make test coupons discoverable.
// Dev helper to make env-var test coupons discoverable (development only).
router.get(
  '/coupon/list',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!testCouponsEnabled()) {
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
  })
);

// ==================== Email Verification ====================

// POST /verify-email — verify a user's email with token
router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
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
      user.onboardingCompletedAt = user.onboardingCompletedAt || new Date();
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
  })
);

// POST /resend-verification — resend verification email
router.post(
  '/resend-verification',
  asyncHandler(async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      const normalizedEmail = String(email).toLowerCase().trim();

      const user = await User.findOne({ email: normalizedEmail });
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.isVerified) return res.json({ message: 'Email already verified' });

      const token = crypto.randomBytes(32).toString('hex');
      const verificationOtp = generateOtp();
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
  })
);

// POST /verify-otp — verify a user's email with otp code
router.post(
  '/verify-otp',
  asyncHandler(async (req, res) => {
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
      user.onboardingCompletedAt = user.onboardingCompletedAt || new Date();
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
  })
);

// ==================== Password Reset ====================

// POST /forgot-password — request a password reset link
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required' });
      const normalizedEmail = String(email).toLowerCase().trim();

      const user = await User.findOne({ email: normalizedEmail });
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
  })
);

// POST /reset-password — set new password using token
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
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
  })
);

module.exports = router;
