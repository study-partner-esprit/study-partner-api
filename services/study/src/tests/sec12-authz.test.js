/**
 * SEC-12 — Cross-user authorization regression.
 *
 * Proves every study resource route filters by the authenticated userId so a
 * client can never read, modify or finalise another user's tasks, topics,
 * sessions or plans (mounted behind the REAL `authenticate` middleware).
 */
process.env.JWT_SECRET = 'sec12-authz-secret';
process.env.JWT_REFRESH_SECRET = 'sec12-authz-refresh';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { authenticate } = require('@study-partner/shared/auth');
const { errorHandler } = require('@study-partner/shared/middleware');

const tasksRouter = require('../routes/tasks');
const topicsRouter = require('../routes/topics');
const sessionsRouter = require('../routes/coreSessions');
const plansRouter = require('../routes/plans');

jest.mock('../models', () => ({
  Task: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() },
  Topic: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() },
  StudySession: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() },
  StudyPlan: { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), deleteOne: jest.fn() },
  Course: { findOne: jest.fn() },
  Subject: {},
  LearningObjective: {},
  Competency: {}
}));
jest.mock('mongoose', () => ({
  connection: { collection: jest.fn(), once: jest.fn() }
}));
jest.mock('axios', () => ({ post: jest.fn().mockResolvedValue({ data: {} }) }));
jest.mock('../utils/gamificationService', () => ({
  processSessionCompletionRewards: jest.fn().mockResolvedValue({}),
  trackAnalyticsEvent: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/competencyQueries', () => ({
  getWeakCompetenciesForCourse: jest.fn().mockResolvedValue([])
}));
jest.mock('@study-partner/shared/tierGate', () => ({
  tierGate: () => (req, res, next) => next()
}));
jest.mock('@study-partner/shared', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const { Task, Topic, StudySession, StudyPlan } = require('../models');
const axios = require('axios');
const mongooseMock = require('mongoose');

const app = express();
app.use(express.json());
app.use('/api/v1/study/tasks', authenticate, tasksRouter);
app.use('/api/v1/study/topics', authenticate, topicsRouter);
app.use('/api/v1/study/sessions', authenticate, sessionsRouter);
app.use('/api/v1/study/plans', authenticate, plansRouter);
app.use(errorHandler);

const userA = { userId: 'user-a', email: 'a@test.com', role: 'student', isActive: true };

function authHeader(u = userA) {
  return { Authorization: `Bearer ${jwt.sign(u, process.env.JWT_SECRET)}` };
}

function renderable(doc) {
  return { lean: jest.fn().mockResolvedValue(doc) };
}

beforeEach(() => jest.clearAllMocks());

describe('SEC-12 tasks are isolated per user', () => {
  it("GET /tasks/:taskId 404s for another user's task", async () => {
    Task.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/study/tasks/task-1').set(authHeader(userA));

    expect(res.status).toBe(404);
    expect(Task.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'task-1', userId: 'user-a' })
    );
  });

  it("PUT /tasks/:taskId never mutates another user's task", async () => {
    Task.findOne.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/v1/study/tasks/task-1')
      .set(authHeader(userA))
      .send({ status: 'completed' });

    // The scoped query (with userId) can never find user-B's task in reality;
    // prove the query is scoped so a foreign document is impossible to reach.
    expect(Task.findOne).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }));
    expect(res.status).toBe(404);
    expect(axios.post).not.toHaveBeenCalled(); // no XP award side-effects
  });
});

describe('SEC-12 topics are isolated per user', () => {
  it("GET /topics/:topicId 404s for another user's topic", async () => {
    Topic.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/study/topics/topic-1').set(authHeader(userA));

    expect(res.status).toBe(404);
    expect(Topic.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'topic-1', userId: 'user-a' })
    );
  });
});

describe('SEC-12 sessions are isolated per user', () => {
  it("GET /sessions/:sessionId 404s for another user's session", async () => {
    StudySession.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/study/sessions/session-1').set(authHeader(userA));

    expect(res.status).toBe(404);
    expect(StudySession.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'session-1', userId: 'user-a' })
    );
  });
});

describe('SEC-12 plans are isolated per user', () => {
  const fakeAiJobColl = { findOne: jest.fn() };
  const OBJECT_ID = '64b000000000000000000001';

  it("GET /plans/:planId 404s for another user's plan", async () => {
    StudyPlan.findOne.mockReturnValue(renderable(null));
    const res = await request(app).get(`/api/v1/study/plans/${OBJECT_ID}`).set(authHeader(userA));

    expect(res.status).toBe(404);
    expect(StudyPlan.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: OBJECT_ID, userId: 'user-a' })
    );
  });

  it('POST /plans/create-status 403s when the job belongs to another user', async () => {
    mongooseMock.connection.collection.mockReturnValue(fakeAiJobColl);
    fakeAiJobColl.findOne.mockResolvedValue({
      correlationId: 'job-1',
      userId: 'user-b',
      status: 'COMPLETED',
      result: { task_graph: { goal: 'G', tasks: [] } }
    });
    StudyPlan.create.mockResolvedValue({
      _id: 'plan-new',
      userId: 'user-b',
      createdAt: new Date()
    });

    const res = await request(app)
      .post('/api/v1/study/plans/create-status')
      .set(authHeader(userA))
      .send({ correlationId: 'job-1' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
    expect(StudyPlan.create).not.toHaveBeenCalled();
    expect(Task.create).not.toHaveBeenCalled();
  });

  it('POST /plans/create-status 201s when the requester owns the job', async () => {
    mongooseMock.connection.collection.mockReturnValue(fakeAiJobColl);
    fakeAiJobColl.findOne.mockResolvedValue({
      correlationId: 'job-2',
      userId: 'user-a',
      status: 'COMPLETED',
      result: {
        fallbackUsed: false,
        task_graph: {
          goal: 'Learn',
          tasks: [{ title: 'Lesson', difficulty: 0.5, estimated_minutes: 25 }]
        }
      }
    });
    StudyPlan.create.mockResolvedValue({
      _id: 'plan-new',
      ...{ userId: 'user-a', goal: 'Learn' },
      createdAt: new Date()
    });

    const res = await request(app)
      .post('/api/v1/study/plans/create-status')
      .set(authHeader(userA))
      .send({ correlationId: 'job-2' });

    expect(res.status).toBe(201);
    expect(StudyPlan.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a' }));
    expect(Task.create).toHaveBeenCalled();
  });

  it('POST /plans/create-status lets admins finalise any job', async () => {
    mongooseMock.connection.collection.mockReturnValue(fakeAiJobColl);
    fakeAiJobColl.findOne.mockResolvedValue({
      correlationId: 'job-3',
      userId: 'user-b',
      status: 'COMPLETED',
      result: { task_graph: { goal: 'G', tasks: [] } }
    });
    StudyPlan.create.mockResolvedValue({
      _id: 'plan-new',
      ...{ userId: 'user-b', goal: 'G' },
      createdAt: new Date()
    });

    const admin = { userId: 'admin-1', email: 'adm@test.com', role: 'admin', isActive: true };
    const res = await request(app)
      .post('/api/v1/study/plans/create-status')
      .set(authHeader(admin))
      .send({ correlationId: 'job-3' });

    expect(res.status).toBe(201);
    expect(StudyPlan.create).toHaveBeenCalled();
  });
});
