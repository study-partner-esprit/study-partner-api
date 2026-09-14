/**
 * SEC-12 — user-profile lockdown regression.
 *
 * Mounts the profile router behind the real `authenticate` middleware and proves
 * that /privacy and /notification-preferences operate strictly on the
 * authenticated userId — a client-supplied userId in the payload can never
 * retrieve or mutate another user's settings.
 */
process.env.JWT_SECRET = 'sec12-profile-secret';
process.env.JWT_REFRESH_SECRET = 'sec12-profile-refresh';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { authenticate } = require('@study-partner/shared/auth');
const { errorHandler } = require('@study-partner/shared/middleware');

jest.mock('@study-partner/shared', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('../models/UserProfile');

const profileRouter = require('../routes/profile');
const UserProfile = require('../models/UserProfile');

const app = express();
app.use(express.json());
app.use('/api/v1/users/profile', authenticate, profileRouter);
app.use(errorHandler);

const alice = { userId: 'user-alice', email: 'alice@test.com', role: 'student', isActive: true };

function authHeader() {
  return { Authorization: `Bearer ${jwt.sign(alice, process.env.JWT_SECRET)}` };
}

function ownProfile() {
  return {
    _id: 'profile-alice',
    userId: 'user-alice',
    nickname: 'Alice',
    bio: '',
    avatar: '',
    preferences: { theme: 'dark' },
    privacy: {
      showOnlineStatus: true,
      showStudyActivity: true,
      showStats: true,
      allowRequests: 'everyone'
    },
    stats: { totalStudyTime: 120, completedTasks: 7 },
    save: jest.fn().mockResolvedValue(true),
    toObject() {
      return { ...this };
    }
  };
}

beforeEach(() => jest.clearAllMocks());

describe('SEC-12 /privacy operates on the authenticated user only', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/v1/users/profile/privacy');
    expect(res.status).toBe(401);
  });

  it('updates privacy for req.user.userId, ignoring a smuggled userId', async () => {
    const profile = ownProfile();
    UserProfile.findOne.mockResolvedValue(profile);

    const res = await request(app).put('/api/v1/users/profile/privacy').set(authHeader()).send({
      userId: 'user-mallory',
      showOnlineStatus: false,
      showStudyActivity: false
    });

    expect(UserProfile.findOne).toHaveBeenCalledWith({ userId: 'user-alice' });
    expect(UserProfile.findOne).not.toHaveBeenCalledWith({ userId: 'user-mallory' });
    expect(res.status).toBe(200);
    expect(profile.save).toHaveBeenCalled();
  });

  it("cannot look up another user's privacy settings via body userId", async () => {
    UserProfile.findOne.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/v1/users/profile/privacy')
      .set(authHeader())
      .send({ userId: 'user-mallory', showStudyActivity: false });

    expect(res.status).toBe(404);
    expect(UserProfile.findOne).toHaveBeenCalledWith({ userId: 'user-alice' });
    expect(UserProfile.findOne).not.toHaveBeenCalledWith({ userId: 'user-mallory' });
  });
});

describe('SEC-12 /notification-preferences operates on the authenticated user only', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/v1/users/profile/notification-preferences');
    expect(res.status).toBe(401);
  });

  it("ignores a smuggled userId and returns the authenticated user's settings", async () => {
    const res = await request(app)
      .put('/api/v1/users/profile/notification-preferences')
      .set(authHeader())
      .send({
        userId: 'user-mallory',
        preferences: { emailNotifications: false, pushNotifications: true }
      });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-alice');
    expect(res.body.userId).not.toBe('user-mallory');
    expect(res.body.preferences.emailNotifications).toBe(false);
  });
});
