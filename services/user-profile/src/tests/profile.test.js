/**
 * User Profile Service Tests
 * Tests profile CRUD and availability endpoints
 */
const express = require('express');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';

// ── Mock UserProfile model ──────────────────────
const mockProfile = {
  _id: '507f1f77bcf86cd799439022',
  userId: 'user-123',
  nickname: 'TestNick',
  bio: 'Test bio',
  avatar: null,
  preferences: { studyTime: 'morning', notifications: { email: true, push: true }, theme: 'dark' },
  goals: [],
  gamification: { xp: 100, level: 2, badges: [], streaks: { current: 5, longest: 10 } },
  availability: [],
  toJSON: function () {
    return { ...this };
  },
  toObject: function () {
    return { ...this };
  },
  save: jest.fn().mockResolvedValue(true)
};

jest.mock('../models/UserProfile', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn()
}));

const UserProfile = require('../models/UserProfile');
const profileRoutes = require('../routes/profile');

const app = express();
app.use(express.json());

// Fake auth middleware — all requests have user
app.use(
  '/api/v1/users/profile',
  (req, res, next) => {
    req.user = { userId: 'user-123' };
    next();
  },
  profileRoutes
);

const request = require('supertest');

describe('User Profile Service', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Get Profile ──────────────────────────────────
  describe('GET /api/v1/users/profile', () => {
    it('should return existing profile', async () => {
      UserProfile.findOne.mockResolvedValue(mockProfile);

      const res = await request(app).get('/api/v1/users/profile');

      expect(res.status).toBe(200);
      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.userId).toBe('user-123');
    });

    it('should create profile if none exists', async () => {
      UserProfile.findOne.mockResolvedValue(null);
      UserProfile.create.mockResolvedValue(mockProfile);

      const res = await request(app).get('/api/v1/users/profile');

      expect(res.status).toBe(200);
      expect(UserProfile.create).toHaveBeenCalledWith({ userId: 'user-123' });
    });
  });

  // ── Update Profile ──────────────────────────────────
  describe('PUT /api/v1/users/profile', () => {
    it('should update nickname and bio', async () => {
      UserProfile.findOne.mockResolvedValue(mockProfile);

      const res = await request(app)
        .put('/api/v1/users/profile')
        .send({ nickname: 'NewNick', bio: 'New bio' });

      expect(res.status).toBe(200);
    });

    it('should reject invalid preferences', async () => {
      const res = await request(app)
        .put('/api/v1/users/profile')
        .send({ preferences: { studyTime: 'invalid-time' } });

      expect(res.status).toBe(400);
    });
  });
});
