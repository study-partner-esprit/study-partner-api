/**
 * SEC-10 — Mass-assignment protection regression tests.
 *
 * Sending privileged fields (role, tier, isAdmin, userId, stats) in the
 * request body must never be persisted, regardless of the endpoint.
 */
process.env.JWT_SECRET = 'test-jwt';
process.env.JWT_REFRESH_SECRET = 'test-refresh';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.NODE_ENV = 'test';

const express = require('express');
const tasksRouter = require('../routes/tasks');
const topicsRouter = require('../routes/topics');
const coreSessionsRouter = require('../routes/coreSessions');
const challengeRouter = require('../routes/challengeSessions');

// ── Mocks ───────────────────────────────────────────────────────────
jest.mock('../utils/gamificationService', () => ({
  processSessionCompletionRewards: jest.fn().mockResolvedValue({}),
  trackAnalyticsEvent: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({ data: { xpAwarded: 10 } }),
  get: jest.fn().mockResolvedValue({ data: {} })
}));

jest.mock('../models', () => {
  const createFn = jest.fn().mockImplementation((doc) => Promise.resolve({ _id: 'new-1', ...doc }));
  const findFn = jest.fn();
  const findOneFn = jest.fn();
  const updateOneFn = jest.fn();
  const deleteOneFn = jest.fn().mockResolvedValue({ deletedCount: 1 });

  return {
    Task: {
      create: createFn,
      find: findFn,
      findOne: findOneFn,
      updateOne: updateOneFn,
      deleteOne: deleteOneFn
    },
    Topic: {
      create: createFn,
      find: findFn,
      findOne: findOneFn,
      updateOne: updateOneFn,
      deleteOne: deleteOneFn
    },
    StudySession: {
      create: createFn,
      find: findFn,
      findOne: findOneFn,
      updateOne: updateOneFn,
      deleteOne: deleteOneFn
    },
    StudyPlan: { find: findFn, findOne: findOneFn },
    Course: { find: findFn, findOne: findOneFn }
  };
});

jest.mock('@study-partner/shared/middleware', () => ({
  asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}));

jest.mock('@study-partner/shared/auth', () => ({
  requireAuth: (req, res, next) => next(),
  requireRole: () => (req, res, next) => next(),
  buildInternalHeaders: () => ({})
}));

const {
  Task: MockTask,
  Topic: MockTopic,
  StudySession: MockStudySession
} = jest.requireMock('../models');
const request = require('supertest');

// ── Shared app ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { userId: 'user-123' };
  req.headers.authorization = 'Bearer tok';
  next();
});
app.use('/tasks', tasksRouter);
app.use('/topics', topicsRouter);
app.use('/sessions', coreSessionsRouter);
app.use('/', challengeRouter);

// ── Helpers ─────────────────────────────────────────────────────────
function mockTask(overrides = {}) {
  return {
    _id: 'task-1',
    userId: 'user-123',
    status: 'todo',
    priority: 'medium',
    save: jest.fn().mockResolvedValue(true),
    toJSON() {
      return { ...this };
    },
    ...overrides
  };
}

function mockSession(overrides = {}) {
  return {
    _id: 'session-1',
    userId: 'user-123',
    mode: 'standard',
    status: 'active',
    startTime: new Date('2026-01-01T10:00:00Z'),
    endTime: null,
    duration: null,
    save: jest.fn().mockResolvedValue(true),
    toObject() {
      return { ...this };
    },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Task tests ──────────────────────────────────────────────────────
describe('SEC-10 task routes reject privileged fields', () => {
  it('POST /tasks creates with only allowed fields', async () => {
    MockTask.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Read', priority: 'high', role: 'admin', tier: 'vip', userId: 'attacker' });

    expect(res.status).toBe(201);
    expect(MockTask.create).toHaveBeenCalledTimes(1);
    const created = MockTask.create.mock.calls[0][0];
    expect(created).toEqual({ userId: 'user-123', title: 'Read', priority: 'high' });
  });

  it('PUT /tasks/:id updates with stripped body', async () => {
    const task = mockTask();
    MockTask.findOne.mockResolvedValue(task);

    const res = await request(app)
      .put('/tasks/task-1')
      .send({ status: 'completed', role: 'admin', isAdmin: true, tier: 'pro' });

    expect(res.status).toBe(200);
    expect(task.save).toHaveBeenCalled();
    expect(task.role).toBeUndefined();
    expect(task.isAdmin).toBeUndefined();
    expect(task.tier).toBeUndefined();
    expect(task.status).toBe('completed');
  });
});

// ── Topic tests ─────────────────────────────────────────────────────
describe('SEC-10 topic routes reject privileged fields', () => {
  it('POST /topics creates with only allowed fields', async () => {
    MockTopic.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post('/topics')
      .send({ name: 'Math', role: 'admin', userId: 'attacker' });

    expect(res.status).toBe(201);
    expect(MockTopic.create).toHaveBeenCalledTimes(1);
    const created = MockTopic.create.mock.calls[0][0];
    expect(created).toEqual({ userId: 'user-123', name: 'Math' });
  });

  it('PUT /topics/:id updates with stripped body', async () => {
    const topic = {
      _id: 'topic-1',
      userId: 'user-123',
      name: 'Math',
      save: jest.fn().mockResolvedValue(true)
    };
    MockTopic.findOne.mockResolvedValue(topic);

    const res = await request(app).put('/topics/topic-1').send({ name: 'Physics', role: 'admin' });

    expect(res.status).toBe(200);
    expect(topic.name).toBe('Physics');
    expect(topic.role).toBeUndefined();
  });
});

// ── Core session tests ──────────────────────────────────────────────
describe('SEC-10 core session routes reject privileged fields', () => {
  it('POST /sessions creates with only allowed fields', async () => {
    MockStudySession.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post('/sessions')
      .send({ duration: 25, topicId: 't1', role: 'admin', stats: { totalStudyTime: 9999 } });

    expect(res.status).toBe(201);
    expect(MockStudySession.create).toHaveBeenCalledTimes(1);
    const created = MockStudySession.create.mock.calls[0][0];
    expect(created).toEqual({
      userId: 'user-123',
      status: 'completed',
      duration: 25,
      topicId: 't1'
    });
  });

  it('PUT /sessions/:id completes with stripped body', async () => {
    const session = mockSession({ startTime: new Date('2026-01-01T10:00:00Z'), endTime: null });
    MockStudySession.findOne.mockResolvedValue(session);

    const res = await request(app)
      .put('/sessions/session-1')
      .send({ status: 'completed', role: 'admin', isAdmin: true });

    expect(res.status).toBe(200);
    expect(session.save).toHaveBeenCalled();
    expect(session.role).toBeUndefined();
    expect(session.isAdmin).toBeUndefined();
    expect(session.status).toBe('completed');
  });
});

// ── Challenge session tests ─────────────────────────────────────────
describe('SEC-10 challenge session complete rejects privileged fields', () => {
  it('PUT /challenge/:id/complete assigns only allowed fields', async () => {
    const session = mockSession({ mode: 'exam', status: 'active' });
    MockStudySession.findOne.mockResolvedValue(session);

    const res = await request(app).put('/challenge/session-1/complete').send({
      duration: 30,
      focusScore: 90,
      completedSuccessfully: true,
      role: 'admin',
      userId: 'attacker'
    });

    expect(res.status).toBe(200);
    expect(session.save).toHaveBeenCalled();
    expect(session.role).toBeUndefined();
    expect(session.mode).toBe('exam');
    expect(session.status).toBe('completed');
    expect(session.duration).toBe(30);
    expect(session.focusScore).toBe(90);
  });
});
