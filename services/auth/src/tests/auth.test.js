/**
 * Auth Service Tests
 * Tests registration, login, token refresh, and /me endpoints
 */
const express = require('express');

// Mock environment before requiring app
process.env.JWT_SECRET = 'test-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';

// ── Mock User model ──────────────────────────────────
const mockUser = {
  _id: '507f1f77bcf86cd799439011',
  email: 'test@example.com',
  name: 'Test User',
  password: '$2a$10$hashedpassword',
  isVerified: true,
  role: 'student',
  lastLogin: null,
  save: jest.fn().mockResolvedValue(true),
  toJSON: function () {
    return { _id: this._id, email: this.email, name: this.name, role: this.role };
  }
};

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn()
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn()
}));

jest.mock('@study-partner/shared/auth', () => ({
  authenticate: (req, res, next) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    req.user = { userId: '507f1f77bcf86cd799439011', role: 'student' };
    return next();
  }
}));

jest.mock('../services/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
  sendSubscriptionExpiryNotice: jest.fn().mockResolvedValue({ success: true })
}));

const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Manually build a mini Express app using the routes
const authRoutes = require('../routes/auth');
const app = express();
app.use(express.json());
app.use('/api/v1/auth', authRoutes);

// Use supertest
const request = require('supertest');

const OTP_MAX_ATTEMPTS = 5;

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Register ──────────────────────────────────
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      User.findOne.mockResolvedValue(null);
      User.create.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'Password123!', name: 'Test User' });

      expect(res.status).toBe(201);
      expect(res.body.requiresVerification).toBe(true);
      expect(res.body.verification.email).toBe('test@example.com');
      expect(res.body.user.email).toBe('test@example.com');
    });

    it('should reject duplicate email', async () => {
      User.findOne.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'Password123!', name: 'Test User' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });

    it('should reject invalid payload', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
    });
  });

  // ── Login ──────────────────────────────────
  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      User.findOne.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.message).toBe('Login successful');
    });

    it('should reject login for unverified users', async () => {
      User.findOne.mockResolvedValue({ ...mockUser, isVerified: false });
      bcrypt.compare.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'Password123!' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('should reject invalid email', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'wrong@example.com', password: 'Password123!' });

      expect(res.status).toBe(401);
    });

    it('should reject wrong password', async () => {
      User.findOne.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'WrongPass!' });

      expect(res.status).toBe(401);
    });
  });

  // ── Refresh ──────────────────────────────────
  describe('POST /api/v1/auth/refresh', () => {
    it('should reject missing refresh token', async () => {
      const res = await request(app).post('/api/v1/auth/refresh').send({});

      expect(res.status).toBe(400);
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(res.status).toBe(401);
    });
  });

  // ── Get Current User ──────────────────────────────────
  describe('GET /api/v1/auth/me', () => {
    it('should return user profile with auth header', async () => {
      User.findById.mockResolvedValue(mockUser);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('test@example.com');
    });

    it('should return 404 when user not found', async () => {
      User.findById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer fake-token');

      expect(res.status).toBe(404);
    });
  });

  // ── OTP lifecycle (SEC-02) ──────────────────────────────────
  describe('POST /api/v1/auth/verify-otp', () => {
    const otpUser = (overrides = {}) => ({
      ...mockUser,
      verificationOtp: '123456',
      verificationOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
      verificationOtpAttempts: 0,
      save: jest.fn().mockResolvedValue(true),
      ...overrides
    });

    it('should verify a valid OTP and reset attempts', async () => {
      const user = otpUser({ verificationOtpAttempts: 2 });
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'test@example.com', otp: '123456' });

      expect(res.status).toBe(200);
      expect(user.isVerified).toBe(true);
      expect(user.verificationOtpAttempts).toBe(0);
      expect(user.save).toHaveBeenCalled();
    });

    it('should reject a wrong OTP and increment attempts', async () => {
      const user = otpUser();
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'test@example.com', otp: '000000' });

      expect(res.status).toBe(400);
      expect(user.verificationOtpAttempts).toBe(1);
      expect(user.save).toHaveBeenCalled();
    });

    it('should lock the OTP out once the attempt budget is exhausted', async () => {
      const user = otpUser({ verificationOtpAttempts: OTP_MAX_ATTEMPTS });
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'test@example.com', otp: '000000' });

      expect(res.status).toBe(429);
      expect(user.verificationOtpAttempts).toBe(OTP_MAX_ATTEMPTS);
    });

    it('should invalidate the OTP when the final attempt fails', async () => {
      const user = otpUser({ verificationOtpAttempts: OTP_MAX_ATTEMPTS - 1 });
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'test@example.com', otp: '000000' });

      expect(res.status).toBe(400);
      expect(user.verificationOtpAttempts).toBe(OTP_MAX_ATTEMPTS);
      expect(user.verificationOtp).toBeUndefined();
      expect(user.verificationOtpExpires).toBeUndefined();
    });

    it('should reject an expired OTP', async () => {
      const user = otpUser({
        verificationOtpExpires: new Date(Date.now() - 1000)
      });
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'test@example.com', otp: '123456' });

      expect(res.status).toBe(400);
      expect(user.verificationOtpAttempts).toBe(1);
    });

    it('should reject malformed OTP payload', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ email: 'test@example.com', otp: 'abc' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/resend-verification', () => {
    it('should reset OTP attempts when issuing a new code', async () => {
      const user = {
        ...mockUser,
        isVerified: false,
        verificationOtpAttempts: 4,
        save: jest.fn().mockResolvedValue(true)
      };
      User.findOne.mockResolvedValue(user);

      const res = await request(app)
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(user.verificationOtpAttempts).toBe(0);
      expect(user.verificationOtp).toBeDefined();
      expect(user.save).toHaveBeenCalled();
    });
  });
});
