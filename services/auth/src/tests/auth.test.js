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

const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Manually build a mini Express app using the routes
const authRoutes = require('../routes/auth');
const app = express();
app.use(express.json());

// Fake auth middleware for /me
app.use(
  '/api/v1/auth',
  (req, res, next) => {
    if (req.headers.authorization) {
      req.user = { userId: '507f1f77bcf86cd799439011' };
    }
    next();
  },
  authRoutes
);

// Use supertest
const request = require('supertest');

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
        .send({ email: 'test@example.com', password: 'Password123', name: 'Test User' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user.email).toBe('test@example.com');
    });

    it('should reject duplicate email', async () => {
      User.findOne.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@example.com', password: 'Password123', name: 'Test User' });

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
        .send({ email: 'test@example.com', password: 'Password123' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.message).toBe('Login successful');
    });

    it('should reject invalid email', async () => {
      User.findOne.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'wrong@example.com', password: 'Password123' });

      expect(res.status).toBe(401);
    });

    it('should reject wrong password', async () => {
      User.findOne.mockResolvedValue(mockUser);
      bcrypt.compare.mockResolvedValue(false);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: 'WrongPass' });

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
});
