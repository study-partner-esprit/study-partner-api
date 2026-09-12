/**
 * INGEST-01 — Course upload file validation (MIME + magic bytes).
 * Route-level tests: valid PDF/text accepted pipeline-wise, spoofed
 * executables / MIME mismatches rejected with 422 and nothing persists.
 */

process.env.JWT_SECRET = 'test-secret-key';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test_study_partner';
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_URL = 'http://ai.test.local'; // never actually hit for rejects

const fs = require('fs');
const UPLOAD_DIR = 'uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

process.exit = jest.fn();

jest.mock('../models/index', () => {
  const mockCourse = jest.fn().mockImplementation(function (data) {
    Object.assign(this, data);
    this._id = 'course-new';
    this.save = jest.fn().mockResolvedValue(true);
    mockCourse.instances.push(this);
  });
  mockCourse.instances = [];
  mockCourse.find = jest.fn();
  mockCourse.findOne = jest.fn();
  mockCourse.findOneAndDelete = jest.fn();
  return {
    Course: mockCourse,
    Subject: { findOne: jest.fn() }
  };
});

jest.mock('../services/objectives', () => ({
  syncObjectivesForDocument: jest
    .fn()
    .mockResolvedValue({ inserted: 0, updated: 0, superseded: 0 }),
  deleteObjectivesForDocument: jest.fn().mockResolvedValue(null)
}));

const { Course, Subject } = require('../models/index');
const courseRoutes = require('../routes/courses');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = express();
const fakeAuth = (req, res, next) => {
  req.user = { userId: 'user-123', tier: 'vip' };
  next();
};

// Shared modules now resolve via the workspace link.
jest.mock('@study-partner/shared/uploadValidation', () => {
  const actual = jest.requireActual('@study-partner/shared/uploadValidation');
  return { ...actual };
});

app.use('/api/v1/study/courses', fakeAuth, courseRoutes);

const { errorHandler } = require('@study-partner/shared/middleware');
app.use(errorHandler);

function authHeader(userId = 'user-123') {
  const token = jwt.sign({ userId, role: 'user' }, process.env.JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF');
const VALID_TEXT = Buffer.from('Introduction to calculus.\nDefinition of a limit.');
const ELF_EXE = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const SHELL_SCRIPT = Buffer.from('#!/bin/sh\nrm -rf /\n');

describe('INGEST-01 POST /api/v1/study/courses (file validation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Course.prototype = {}; // no-op safety
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test('rejects an executable disguised as .pdf with 422 and no course created', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', ELF_EXE, { filename: 'evil.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Upload rejected|application\/pdf|content is not a PDF|binary/);
    expect(Course.find).not.toHaveBeenCalled();
  });

  test('rejects a shell script renamed to .txt with 422', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', SHELL_SCRIPT, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Upload rejected|binary\/script/);
  });

  test('rejects a PDF renamed to .txt (content mismatch) with 422', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', VALID_PDF, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Upload rejected|content is a PDF/);
  });

  test('rejects unsupported MIME type at the multer filter with 422', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Bad Course')
      .field('subject_id', 'subj-1')
      .attach('files', ELF_EXE, { filename: 'evil.exe', contentType: 'application/x-msdownload' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/unsupported file type/);
  });

  test('accepts valid PDF + text files and proceeds to AI ingest', async () => {
    const axios = require('axios');
    jest.spyOn(axios, 'post').mockResolvedValue({ data: { course_id: 'c1', topics: [] } });

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Good Course')
      .field('subject_id', 'subj-1')
      .attach('files', VALID_PDF, { filename: 'notes.pdf', contentType: 'application/pdf' })
      .attach('files', VALID_TEXT, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(201);
    expect(Course).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Good Course', status: 'processing' })
    );

    const instance = Course.instances[0];
    expect(instance.save).toHaveBeenCalled();
  }, 10000);
});

describe('INGEST-02 POST /api/v1/study/courses (size limits → 413)', () => {
  const { MAX_UPLOAD_MB } = require('@study-partner/shared/uploadValidation');

  beforeEach(() => {
    jest.clearAllMocks();
    Course.instances = [];
    Course.prototype = {}; // no-op safety
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test(`rejects a single file over ${MAX_UPLOAD_MB}MB with 413`, async () => {
    const oversized = Buffer.alloc((MAX_UPLOAD_MB + 1) * 1024 * 1024, 0x25);

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Oversized Course')
      .field('subject_id', 'subj-1')
      .attach('files', oversized, { filename: 'big.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(new RegExp(`${MAX_UPLOAD_MB}MB`));
    expect(Course).not.toHaveBeenCalled();
    expect(Course.instances).toHaveLength(0);
  }, 30000);

  test('leaves no residue on disk after a size-limit rejection', async () => {
    const fs = require('fs');
    const before = fs.readdirSync('uploads');
    const oversized = Buffer.alloc((MAX_UPLOAD_MB + 1) * 1024 * 1024, 0x41);

    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .field('title', 'Oversized Course 2')
      .field('subject_id', 'subj-1')
      .attach('files', oversized, { filename: 'big.txt', contentType: 'text/plain' });

    expect(res.status).toBe(413);
    const after = fs.readdirSync('uploads');
    expect(after).toEqual(before);
  }, 30000);
});

describe('INGEST-03 POST /api/v1/study/courses (content-type allowlist → 415)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Course.instances = [];
    Course.prototype = {}; // no-op safety
    Subject.findOne.mockResolvedValue({ _id: 'subj-1', userId: 'user-123' });
  });

  test('rejects JSON-typed upload with 415 before any persistence', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses')
      .set(authHeader())
      .set('Content-Type', 'application/json')
      .send({ title: 'Bad', subject_id: 'subj-1' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/multipart\/form-data/);
    expect(Course).not.toHaveBeenCalled();
    expect(Course.instances).toHaveLength(0);
  });

  test('rejects non-multipart re-ingest request with 415', async () => {
    const res = await request(app)
      .post('/api/v1/study/courses/some-course/files')
      .set(authHeader())
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('file=not-a-file');

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/multipart\/form-data/);
  });
});
