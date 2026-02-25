/**
 * Study Service Tests
 * Tests course upload, plan CRUD, and task completion endpoints
 */
const express = require('express');

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';

// ── Mock Models ──────────────────────────────────
const mockCourse = {
  _id: 'course-1',
  userId: 'user-123',
  title: 'Test Course',
  status: 'active',
  modules: [],
  toJSON: function () { return { ...this }; },
  save: jest.fn().mockResolvedValue(true)
};

const mockPlan = {
  _id: 'plan-1',
  userId: 'user-123',
  courseId: 'course-1',
  title: 'Test Plan',
  status: 'active',
  tasks: [
    { _id: 'task-1', title: 'Task 1', status: 'pending', duration_minutes: 30 },
    { _id: 'task-2', title: 'Task 2', status: 'pending', duration_minutes: 45 }
  ],
  toJSON: function () { return { ...this }; },
  save: jest.fn().mockResolvedValue(true)
};

jest.mock('../models/Course', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn()
}));

jest.mock('../models/StudyPlan', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn()
}));

const Course = require('../models/Course');
const StudyPlan = require('../models/StudyPlan');

// Build app with routes
const app = express();
app.use(express.json());

// Fake auth
const fakeAuth = (req, res, next) => {
  req.user = { userId: 'user-123' };
  next();
};

const courseRoutes = require('../routes/courses');
const planRoutes = require('../routes/plans');

app.use('/api/v1/study/courses', fakeAuth, courseRoutes);
app.use('/api/v1/study/plans', fakeAuth, planRoutes);

const request = require('supertest');

describe('Study Service', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Courses ──────────────────────────────────
  describe('Courses', () => {
    describe('GET /api/v1/study/courses', () => {
      it('should return user courses', async () => {
        Course.find.mockReturnValue({
          sort: jest.fn().mockResolvedValue([mockCourse])
        });

        const res = await request(app).get('/api/v1/study/courses');
        expect(res.status).toBe(200);
        expect(res.body.courses).toHaveLength(1);
      });
    });

    describe('GET /api/v1/study/courses/:id', () => {
      it('should return a specific course', async () => {
        Course.findOne.mockResolvedValue(mockCourse);

        const res = await request(app).get('/api/v1/study/courses/course-1');
        expect(res.status).toBe(200);
      });

      it('should return 404 for missing course', async () => {
        Course.findOne.mockResolvedValue(null);

        const res = await request(app).get('/api/v1/study/courses/nonexistent');
        expect(res.status).toBe(404);
      });
    });

    describe('DELETE /api/v1/study/courses/:id', () => {
      it('should delete a course', async () => {
        Course.findOneAndDelete.mockResolvedValue(mockCourse);

        const res = await request(app).delete('/api/v1/study/courses/course-1');
        expect(res.status).toBe(200);
      });
    });
  });

  // ── Plans ──────────────────────────────────
  describe('Plans', () => {
    describe('GET /api/v1/study/plans', () => {
      it('should return user study plans', async () => {
        StudyPlan.find.mockReturnValue({
          sort: jest.fn().mockResolvedValue([mockPlan])
        });

        const res = await request(app).get('/api/v1/study/plans');
        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/v1/study/plans/:id', () => {
      it('should return a specific plan', async () => {
        StudyPlan.findOne.mockResolvedValue(mockPlan);

        const res = await request(app).get('/api/v1/study/plans/plan-1');
        expect(res.status).toBe(200);
      });

      it('should return 404 for missing plan', async () => {
        StudyPlan.findOne.mockResolvedValue(null);

        const res = await request(app).get('/api/v1/study/plans/nonexistent');
        expect(res.status).toBe(404);
      });
    });
  });
});
