/**
 * Coach API tests (COACH-10)
 * POST /api/v1/coach/nudge → 202 { jobId }
 * GET  /api/v1/coach/jobs/:jobId → status + nudge
 */
const express = require('express');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_coach_partner';
process.env.NODE_ENV = 'test';

// Prevent process.exit() from killing tests
process.exit = jest.fn();

const mongoose = require('mongoose');

const mockStudySession = {
  _id: 'session-1',
  userId: 'user-123',
  status: 'active',
  subjectId: 'subject-1'
};

// findOne returns a chainable query supporting .sort()
const mockSessionQuery = (result) => ({
  sort: jest.fn().mockResolvedValue(result)
});

jest.mock('../models/index', () => ({
  StudySession: {
    findOne: jest.fn().mockReturnValue(mockSessionQuery(mockStudySession)),
    find: jest.fn()
  }
}));

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const request = require('supertest');
const axios = require('axios');
const { StudySession } = require('../models/index');
const { generateToken } = require('@study-partner/shared/auth');
const app = require('../app');

const token = `Bearer ${generateToken({ userId: 'user-123', role: 'student', tier: 'vip' })}`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/v1/coach/nudge', () => {
  it('returns 401 for an unauthenticated request (COACH-11 negative)', async () => {
    const res = await request(app).post('/api/v1/coach/nudge').send({ focus_score: 0.5 });

    expect(res.status).toBe(401);
    expect(StudySession.findOne).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns 202 with jobId when a nudge is scheduled against the active session', async () => {
    StudySession.findOne.mockReturnValue(mockSessionQuery(mockStudySession));
    axios.post.mockResolvedValue({
      data: { jobId: 'job-1', correlationId: 'corr-1' }
    });

    const res = await request(app).post('/api/v1/coach/nudge').set('Authorization', token);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('processing');
    expect(res.body.jobId).toBe('job-1');
    expect(res.body.correlationId).toBe('corr-1');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ai/jobs'),
      expect.objectContaining({
        type: 'study.coach.nudge',
        payload: expect.objectContaining({ session_id: 'session-1' })
      }),
      expect.anything()
    );
  });

  it('returns 400 when no active session exists for the user', async () => {
    StudySession.findOne.mockReturnValue(mockSessionQuery(null));

    const res = await request(app).post('/api/v1/coach/nudge').set('Authorization', token);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active study session/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns 404 for a session_id that does not belong to the user', async () => {
    // Explicit session_id path uses findOne without .sort → resolve to null
    StudySession.findOne.mockReturnValue(Promise.resolve(null));

    const res = await request(app)
      .post('/api/v1/coach/nudge')
      .set('Authorization', token)
      .send({ session_id: 'foreign-session' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid payload (score outside [0,1])', async () => {
    const res = await request(app)
      .post('/api/v1/coach/nudge')
      .set('Authorization', token)
      .send({ focus_score: 2.5 });

    expect(res.status).toBe(400);
    // Validation happens before any DB lookup
    expect(StudySession.findOne).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns 503 when the orchestrator job bus is unreachable', async () => {
    StudySession.findOne.mockReturnValue(mockSessionQuery(mockStudySession));
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await request(app).post('/api/v1/coach/nudge').set('Authorization', token);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/unavailable/i);
  });

  it('defaults current_time when not supplied', async () => {
    const posted = {};
    axios.post.mockImplementation(async (url, body, opts) => {
      Object.assign(posted, body);
      return { data: { jobId: 'job-1', correlationId: 'corr-1' } };
    });

    const res = await request(app).post('/api/v1/coach/nudge').set('Authorization', token);

    expect(res.status).toBe(202);
    expect(posted.payload.current_time).toBeTruthy();
    expect(new Date(posted.payload.current_time).toString()).not.toBe('Invalid Date');
  });
});

describe('GET /api/v1/coach/jobs/:jobId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns job status + nudge result scoped to the owning user', async () => {
    const collectionFindOne = jest.fn().mockResolvedValue({
      jobId: 'job-1',
      userId: 'user-123',
      status: 'COMPLETED',
      result: { nudge: 'TEST_POMODORO', reason: 'test double' },
      fallbackUsed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({ findOne: collectionFindOne });

    const res = await request(app).get('/api/v1/coach/jobs/job-1').set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.result.nudge).toBe('TEST_POMODORO');
    expect(collectionFindOne).toHaveBeenCalledWith({ jobId: 'job-1', userId: 'user-123' });
  });

  it('adds userId scoping so another user cannot read the job', async () => {
    const collectionFindOne = jest.fn().mockResolvedValue(null);
    jest.spyOn(mongoose.connection, 'collection').mockReturnValue({ findOne: collectionFindOne });

    const res = await request(app).get('/api/v1/coach/jobs/job-1').set('Authorization', token);

    expect(res.status).toBe(404);
    expect(collectionFindOne).toHaveBeenCalledWith({ jobId: 'job-1', userId: 'user-123' });
  });
});

// Helpers used across tests
module.exports = { app, mockStudySession };
