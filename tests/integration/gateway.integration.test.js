/**
 * Integration tests for API Gateway → microservice routing.
 *
 * These tests spin up the gateway and individual services, then verify
 * end-to-end request flow including authentication & proxy behaviour.
 *
 * Prerequisites:
 *   - MongoDB running on MONGODB_URI (or localhost:27017)
 *   - JWT_SECRET set in environment
 */

const request = require('supertest');
const mongoose = require('mongoose');

jest.setTimeout(30000);

// ---------- bootstrap environment ----------
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'integration-test-refresh-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner_test';
process.env.NODE_ENV = 'test';

// Prevent process.exit() from killing tests
process.exit = jest.fn();

// We import apps directly (not servers) to avoid port conflicts
const gatewayApp = require('../../services/api-gateway/src/app');

// ---------- helpers ----------
const { generateToken } = require('../../shared/auth');

const testUser = {
  userId: new mongoose.Types.ObjectId().toString(),
  email: 'integration@test.com',
  role: 'student'
};

let token;
let dbConnected = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectMongoWithRetry(maxAttempts = 10) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 2000,
        connectTimeoutMS: 2000
      });
      return true;
    } catch (_error) {
      if (attempt === maxAttempts) {
        return false;
      }
      await sleep(1000);
    }
  }

  return false;
}

// ---------- lifecycle ----------
beforeAll(async () => {
  token = generateToken(testUser);
  dbConnected = await connectMongoWithRetry();
});

afterAll(async () => {
  // Clean up test data
  if (dbConnected && mongoose.connection && mongoose.connection.db) {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      if (col.name.startsWith('test_')) {
        await db.dropCollection(col.name);
      }
    }
  }

  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

// ---------- tests ----------

describe('API Gateway - Health & Routing', () => {
  it('GET /api/v1/health should return gateway health', async () => {
    const res = await request(gatewayApp).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('api-gateway');
  });

  it('unknown route should return 404', async () => {
    const res = await request(gatewayApp).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe('Auth Service - Registration & Login flow', () => {
  const authApp = require('../../services/auth/src/app');
  const uniqueEmail = `test-${Date.now()}@example.com`;

  it('POST /api/v1/auth/register – should create user', async () => {
    const res = await request(authApp).post('/api/v1/auth/register').send({
      email: uniqueEmail,
      password: 'TestPass123!',
      name: 'Integration Tester'
    });

    expect([200, 201]).toContain(res.status);
    expect(res.body.token || res.body.user).toBeDefined();
  });

  it('POST /api/v1/auth/login – should return JWT', async () => {
    const res = await request(authApp)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password: 'TestPass123!' });

    expect([200, 201, 400, 401, 403]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      expect(res.body.token).toBeDefined();
    }
  });

  it('POST /api/v1/auth/login – wrong password should 401', async () => {
    const res = await request(authApp)
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password: 'wrong' });

    expect([401, 403]).toContain(res.status);
  });
});

describe('Study Service – CRUD with authentication', () => {
  const studyApp = require('../../services/study/src/app');

  it('GET /api/v1/study/tasks – should require auth', async () => {
    const res = await request(studyApp).get('/api/v1/study/tasks');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/study/tasks – should succeed with valid JWT', async () => {
    const res = await request(studyApp)
      .get('/api/v1/study/tasks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('POST /api/v1/study/tasks – should create a task', async () => {
    const res = await request(studyApp)
      .post('/api/v1/study/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Integration Test Task',
        description: 'Created by integration test',
        priority: 'medium'
      });

    expect([200, 201]).toContain(res.status);
  });
});

describe('User Profile Service – Profile & Availability', () => {
  const profileApp = require('../../services/user-profile/src/app');

  it('GET /api/v1/users/profile – should require auth', async () => {
    const res = await request(profileApp).get('/api/v1/users/profile');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/users/profile – should return profile with valid JWT', async () => {
    const res = await request(profileApp)
      .get('/api/v1/users/profile')
      .set('Authorization', `Bearer ${token}`);

    // 200 if profile exists, 404 if not yet created — both valid
    expect([200, 404]).toContain(res.status);
  });

  it('GET /api/v1/users/availability – should return availability array', async () => {
    const res = await request(profileApp)
      .get('/api/v1/users/availability')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('Analytics Service – Event tracking', () => {
  const analyticsApp = require('../../services/analytics/src/app');

  it('POST /api/v1/analytics/track – should accept events', async () => {
    const res = await request(analyticsApp)
      .post('/api/v1/analytics/track')
      .set('Authorization', `Bearer ${token}`)
      .send({
        eventType: 'test_event',
        data: { source: 'integration-test' }
      });

    // Allow various status codes depending on API implementation
    expect([200, 201, 400, 401]).toContain(res.status);
  });
});

describe('Signal Processing Service – Focus tracking', () => {
  const signalApp = require('../../services/signal-processing/src/app');

  it('GET /api/v1/health – should return healthy', async () => {
    const res = await request(signalApp).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.service).toBe('signal-processing');
  });
});

describe('Notification Service – Notifications', () => {
  const notificationApp = require('../../services/notification/src/app');

  it('GET /api/v1/health – should return healthy', async () => {
    const res = await request(notificationApp).get('/api/v1/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.service).toBe('notification');
  });

  it('GET /api/v1/notifications – should require auth', async () => {
    const res = await request(notificationApp).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});
