/**
 * SEC-12 — Negative authentication regression (real `authenticate` middleware).
 *
 * Uses the REAL `@study-partner/shared/auth` middleware against a mounted study
 * route to prove missing, expired, invalid, wrong-secret and deactivated tokens
 * are all rejected with 401 before any handler runs.
 */
process.env.JWT_SECRET = 'sec12-test-secret';
process.env.JWT_REFRESH_SECRET = 'sec12-test-refresh';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { authenticate } = require('@study-partner/shared/auth');
const tasksRouter = require('../routes/tasks');

jest.mock('../models', () => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    lean: () => []
  };
  return {
    Task: {
      find: jest.fn().mockReturnValue(chain),
      findOne: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn()
    }
  };
});
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: {} }) }));

const app = express();
app.use(express.json());
app.use('/api/v1/study/tasks', authenticate, tasksRouter);

const bob = { userId: 'user-bob', email: 'bob@test.com', role: 'student', isActive: true };

function token(payload = bob, secret = process.env.JWT_SECRET) {
  return jwt.sign(payload, secret);
}

function expiredToken() {
  return jwt.sign({ ...bob, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
}

describe('SEC-12 negative authentication (real middleware, mounted route)', () => {
  it('rejects a missing token with 401', async () => {
    const res = await request(app).get('/api/v1/study/tasks');
    expect(res.status).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    const res = await request(app)
      .get('/api/v1/study/tasks')
      .set('Authorization', `Bearer ${expiredToken()}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret with 401', async () => {
    const res = await request(app)
      .get('/api/v1/study/tasks')
      .set('Authorization', `Bearer ${token(bob, 'wrong-secret')}`);
    expect(res.status).toBe(401);
  });

  it('rejects a malformed junk token with 401', async () => {
    const res = await request(app)
      .get('/api/v1/study/tasks')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated account (isActive:false) with 401', async () => {
    const res = await request(app)
      .get('/api/v1/study/tasks')
      .set('Authorization', `Bearer ${token({ ...bob, isActive: false })}`);
    expect(res.status).toBe(401);
  });

  it('accepts a valid token (200)', async () => {
    const res = await request(app)
      .get('/api/v1/study/tasks')
      .set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tasks');
  });
});
