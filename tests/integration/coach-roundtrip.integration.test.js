/**
 * COACH-11 — Coach end-to-end test through the real job bus.
 *
 * Proves one real nudge travels: study-service POST /api/v1/coach/nudge →
 * orchestrator /api/v1/ai/jobs (AiJob persisted, PENDING) → RabbitMQ →
 * the REAL CoachWorker (LLM mocked with LLM_MOCK=1) → COACH-09 history row →
 * results inbox → Node result consumer → AiJob COMPLETED with the nudge →
 * GET /api/v1/coach/jobs/:jobId returns status + nudge (owner-scoped).
 *
 * Negative AC: an unauthenticated /api/v1/coach/nudge is rejected (401).
 *
 * Requires a real broker + Mongo:
 *   RABBITMQ_URL=amqp://guest:guest@localhost:5672/%2F \
 *   MONGODB_URI=mongodb://localhost:27017/study_partner_test \
 *   AI_RETRY_DELAYS_MS='[100,100,100]' npx jest tests/integration/coach-roundtrip...
 *
 * Skipped when RABBITMQ_URL is not set (CI runs it with a service container).
 */

const path = require('path');
const { spawn } = require('child_process');
const request = require('supertest');
const mongoose = require('mongoose');

jest.setTimeout(120000);

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'integration-test-refresh-secret';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner_test';
process.env.NODE_ENV = 'test';
// Tiny retry ladder so any exhaustion completes in milliseconds (inherited by
// the spawned worker). Must be set before messenger modules load.
process.env.AI_RETRY_DELAYS_MS = '[100,100,100]';

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const d = RABBITMQ_URL ? describe : describe.skip;

const USER_ID = 'coach-roundtrip-user';

let studyApp;
let orchApp;
let orchServer;
let AiJob;
let StudySession;
let amqp;
let conn;

beforeAll(async () => {
  studyApp = require('../../services/study/src/app');
  orchApp = require('../../services/ai-orchestrator/src/app');
  AiJob = require('../../services/ai-orchestrator/src/models/AiJob');
  StudySession = require('../../services/study/src/models').StudySession;
  amqp = require('amqplib');
});

afterAll(async () => {
  if (conn) await conn.close();
  if (orchServer) await new Promise((r) => orchServer.close(r));
  await mongoose.disconnect();
});

async function connectMongoWithRetry(maxAttempts = 10) {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
      return;
    } catch (err) {
      if (i === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function spawnCoachWorker() {
  const aiRoot = path.join(__dirname, '../../../study-partner-ai');
  const child = spawn('python3', ['-m', 'tests.e2e_coach_worker'], {
    cwd: aiRoot,
    env: {
      ...process.env,
      PYTHONPATH: `${aiRoot}:${path.join(aiRoot, 'agents', 'evaluator')}`,
      LLM_MOCK: '1',
      RABBITMQ_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`coach worker not ready: ${stderr}`)), 30000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('STUB_WORKER_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`coach worker exited early (${code}): ${stderr.slice(-500)}`));
    });
  });
  return { child, ready };
}

async function waitFor(predicate, timeoutMs = 45000, intervalMs = 250) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

d('COACH-11 coach round trip (real RabbitMQ)', () => {
  let coachWorker;

  beforeAll(async () => {
    await connectMongoWithRetry();

    await AiJob.deleteMany({ userId: USER_ID });
    // Seed an active study session for the user (touches the real collection
    // so the study-service model query finds it).
    const sessionColl = StudySession.collection;
    await sessionColl.deleteMany({ userId: USER_ID });
    await sessionColl.insertOne({
      userId: USER_ID,
      status: 'active',
      mode: 'focus',
      duration: 25,
      createdAt: new Date(),
      updatedAt: new Date(),
      // COACH-13: give the session real stats so the nudge route derives a
      // populated session_stats block whose bounds survive the bus end-to-end.
      startTime: new Date(Date.now() - 10 * 60 * 1000),
      taskProgress: {
        currentTaskIndex: 1,
        totalTasks: 2,
        completedTasks: 1
      },
      breakStats: { totalBreaks: 1 }
    });

    conn = await amqp.connect(RABBITMQ_URL);

    // Boot the orchestrator HTTP API on an ephemeral port and point the study
    // service's nudge route at it (plans.js-style env read is per-request).
    orchServer = orchApp.listen(0);
    await new Promise((r) => orchServer.once('listening', r));
    process.env.AI_ORCHESTRATOR_URL = `http://localhost:${orchServer.address().port}`;
  });

  afterAll(async () => {
    if (coachWorker) coachWorker.child.kill('SIGTERM');
  });

  test('happy path: nudge → real coach worker → COMPLETED → status + nudge', async () => {
    coachWorker = spawnCoachWorker();
    await coachWorker.ready;

    try {
      // Subscribe to results BEFORE creating the job (no missed events).
      const {
        startResultConsumer
      } = require('../../services/ai-orchestrator/src/services/jobResultConsumer');
      await startResultConsumer();

      const token = await require('../../shared/auth').generateToken({
        userId: USER_ID,
        email: 'coach-rt@test.com',
        role: 'student',
        tier: 'vip'
      });

      const res = await request(studyApp)
        .post('/api/v1/coach/nudge')
        .set('Authorization', `Bearer ${token}`)
        .send({ focus_score: 0.2, focus_state: 'Lost' });

      expect(res.status).toBe(202);
      const { jobId, correlationId } = res.body;
      expect(jobId).toBeTruthy();

      await waitFor(async () => {
        const job = await AiJob.findOne({ jobId }).lean();
        return job && job.status === 'COMPLETED';
      }, 45000);

      const job = await AiJob.findOne({ jobId }).lean();
      expect(job.userId).toBe(USER_ID);
      expect(job.correlationId).toBe(correlationId); // end-to-end correlation intact
      expect(job.result).toBeTruthy();
      expect(job.result.fallbackUsed).toBeDefined();
      expect(job.result.nudge).toBeTruthy();
      expect(job.result.nudge.nudge_text).toBeTruthy();
      expect(job.result.nudge.category).toBeTruthy();

      // Owner-scoped status readback returns the rendered nudge.
      const statusRes = await request(studyApp)
        .get(`/api/v1/coach/jobs/${jobId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.status).toBe('COMPLETED');
      expect(statusRes.body.result.nudge.nudge_text).toBe(job.result.nudge.nudge_text);
    } finally {
      coachWorker.child.kill('SIGTERM');
      coachWorker = null;
    }
  });

  test('negative: unauthenticated nudge request is rejected (401)', async () => {
    const res = await request(studyApp).post('/api/v1/coach/nudge').send({ focus_score: 0.5 });
    expect(res.status).toBe(401);
  });
});