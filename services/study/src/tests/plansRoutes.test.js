/**
 * BLOOM-10 — plans route wiring (Node side).
 *
 * Verifies:
 *  - POST /api/v1/plans/create includes the user's weak_competencies in the
 *    `study.plan.generate` payload sent to the orchestrator.
 *  - POST /api/v1/plans/create-status persists objectiveId/targetBloomLevel on
 *    tasks and echoes objective_id/target_bloom_level onto taskGraph tasks.
 */

const express = require('express');
const request = require('supertest');

const MOCK_COURSE = { _id: 'course-1', userId: 'user-123', status: 'completed' };

jest.mock('../models/index', () => ({
  Course: {
    findOne: jest.fn(async () => MOCK_COURSE)
  },
  StudyPlan: {
    create: jest.fn(async (doc) => ({
      _id: { toString: () => 'plan-1' },
      ...doc,
      userId: doc.userId,
      goal: doc.goal,
      availableTimeMinutes: doc.availableTimeMinutes,
      totalEstimatedMinutes: doc.totalEstimatedMinutes,
      status: 'created',
      warning: doc.warning,
      taskGraph: doc.taskGraph,
      createdAt: new Date()
    }))
  },
  Task: {
    create: jest.fn(async (doc) => ({ _id: 'task-1', ...doc }))
  }
}));

jest.mock('../services/competencyQueries', () => ({
  getWeakCompetenciesForCourse: jest.fn()
}));

jest.mock('axios', () => ({
  post: jest.fn()
}));

const mongoose = require('mongoose');
const axios = require('axios');
const { StudyPlan, Task } = require('../models/index');
const { getWeakCompetenciesForCourse } = require('../services/competencyQueries');

const plansRoutes = require('../routes/plans');

const app = express();
app.use(express.json());
const fakeAuth = (req, res, next) => {
  req.user = { userId: 'user-123', tier: 'vip' };
  next();
};
app.use('/api/v1/plans', fakeAuth, plansRoutes);

beforeEach(() => jest.clearAllMocks());

describe('POST /api/v1/plans/create — weak_competencies payload', () => {
  test('includes the user weak competencies scoped to the course', async () => {
    getWeakCompetenciesForCourse.mockResolvedValue([
      { topic_id: 'sorting', topic_title: 'Sorting Algorithms', scores: { apply: 0.4 } }
    ]);
    axios.post.mockResolvedValue({
      data: { jobId: 'job-1', correlationId: 'corr-1' }
    });

    const res = await request(app)
      .post('/api/v1/plans/create')
      .send({ goal: 'Learn sorting', availableTimeMinutes: 120, courseId: 'course-1' });

    expect(res.status).toBe(202);
    expect(getWeakCompetenciesForCourse).toHaveBeenCalledWith('user-123', 'course-1');
    const [, body] = axios.post.mock.calls[0];
    expect(body.type).toBe('study.plan.generate');
    expect(body.payload.weak_competencies).toEqual([
      { topic_id: 'sorting', topic_title: 'Sorting Algorithms', scores: { apply: 0.4 } }
    ]);
  });

  test('still generates the plan when no competency data exists (empty array)', async () => {
    getWeakCompetenciesForCourse.mockResolvedValue([]);
    axios.post.mockResolvedValue({ data: { jobId: 'job-1', correlationId: 'corr-1' } });

    const res = await request(app)
      .post('/api/v1/plans/create')
      .send({ goal: 'Learn sorting', availableTimeMinutes: 120, courseId: 'course-1' });

    expect(res.status).toBe(202);
    expect(axios.post.mock.calls[0][1].payload.weak_competencies).toEqual([]);
  });

  test('degrades gracefully if the competency query throws', async () => {
    getWeakCompetenciesForCourse.mockRejectedValue(new Error('db down'));
    axios.post.mockResolvedValue({ data: { jobId: 'job-1', correlationId: 'corr-1' } });

    const res = await request(app)
      .post('/api/v1/plans/create')
      .send({ goal: 'Learn sorting', availableTimeMinutes: 120, courseId: 'course-1' });

    expect(res.status).toBe(202);
    expect(axios.post.mock.calls[0][1].payload.weak_competencies).toEqual([]);
  });
});

describe('POST /api/v1/plans/create-status — competency target persistence', () => {
  function aiJobsResult(taskOverrides = {}) {
    return {
      userId: 'user-123',
      status: 'COMPLETED',
      result: {
        task_graph: {
          goal: 'Learn sorting',
          tasks: [
            {
              id: 't1',
              title: 'Sorting Algorithms Practice',
              description: 'implement quicksort',
              estimated_minutes: 30,
              difficulty: 0.5,
              objective_id: 'sorting',
              target_bloom_level: 'apply'
            },
            {
              id: 't2',
              title: 'Arrays Review',
              description: 'basic arrays',
              estimated_minutes: 20,
              difficulty: 0.3
            },
            ...(taskOverrides.extra || [])
          ]
        }
      }
    };
  }

  test('persists objectiveId/targetBloomLevel on each task and in taskGraph', async () => {
    const aiJob = aiJobsResult();
    const aiJobsColl = {
      findOne: jest.fn(async () => aiJob)
    };
    const original = mongoose.connection;
    Object.defineProperty(mongoose.connection, 'collection', {
      value: jest.fn(() => aiJobsColl),
      configurable: true
    });

    const res = await request(app)
      .post('/api/v1/plans/create-status')
      .send({ correlationId: 'corr-1' });

    expect(res.status).toBe(201);
    // first task carries the competency target
    expect(Task.create.mock.calls[0][0]).toMatchObject({
      objectiveId: 'sorting',
      targetBloomLevel: 'apply',
      userId: 'user-123',
      studyPlanId: 'plan-1'
    });
    // second task (no target in AI result) -> fields absent
    expect(Task.create.mock.calls[1][0]).toMatchObject({
      objectiveId: undefined,
      targetBloomLevel: undefined
    });

    // taskGraph persisted with snake_case competency echo
    const savedPlanDoc = StudyPlan.create.mock.calls[0][0];
    expect(savedPlanDoc.taskGraph.tasks[0]).toMatchObject({
      objective_id: 'sorting',
      target_bloom_level: 'apply'
    });
    expect(savedPlanDoc.taskGraph.tasks[1]).not.toHaveProperty('objective_id');
    expect(original).toBe(mongoose.connection);
  });
});
