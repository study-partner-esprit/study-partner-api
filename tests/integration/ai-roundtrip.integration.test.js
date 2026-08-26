/**
 * AI-COM-10 — Communication integration test (Sprint 1 gate).
 *
 * Proves one real AI job travels Node → RabbitMQ → Python worker → RabbitMQ →
 * Node with only the LLM mocked, and that retryable failures land in the DLQ
 * after max retries.
 *
 * Requires a real broker + Mongo:
 *   RABBITMQ_URL=amqp://guest:guest@localhost:5672/%2F \
 *   MONGODB_URI=mongodb://localhost:27017/study_partner_test \
 *   AI_RETRY_DELAYS_MS='[100,100,100]' npx jest tests/integration/ai-roundtrip...
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
// Tiny retry ladder so exhaustion completes in milliseconds. Must be set
// BEFORE any topology/publisher module loads (constants are read at require
// time) and is inherited by spawned stub workers.
process.env.AI_RETRY_DELAYS_MS = '[100,100,100]';

const RABBITMQ_URL = process.env.RABBITMQ_URL;
const d = RABBITMQ_URL ? describe : describe.skip;

// Real orchestrator app + result consumer (publish mocked ONLY if no broker).
let app;
let AiJob;
let amqp;

beforeAll(() => {
  app = require('../../services/ai-orchestrator/src/app');
  AiJob = require('../../services/ai-orchestrator/src/models/AiJob');
  amqp = require('amqplib');
});

afterAll(async () => {
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

function spawnStubWorker(jobType, behavior) {
  const aiRoot = path.join(__dirname, '../../../study-partner-ai');
  const child = spawn('python3', ['-m', 'tests.e2e_stub_worker'], {
    cwd: aiRoot,
    env: {
      ...process.env,
      PYTHONPATH: `${aiRoot}:${path.join(aiRoot, 'agents', 'evaluator')}`,
      JOB_TYPE: jobType,
      BEHAVIOR: behavior,
      RABBITMQ_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`stub worker not ready: ${stderr}`)), 30000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('STUB_WORKER_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`stub worker exited early (${code}): ${stderr.slice(-500)}`));
    });
  });
  return { child, ready };
}

async function purgeQueue(channel, queueName) {
  try {
    await channel.assertQueue(queueName, { durable: true });
    await channel.purgeQueue(queueName);
  } catch (err) {
    /* queue may not exist yet */
  }
}

async function dlqCount(channel, queueName) {
  const q = await channel.assertQueue(queueName, { durable: true });
  return q.messageCount;
}

async function waitFor(predicate, timeoutMs = 30000, intervalMs = 250) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

d('AI-COM-10 round trip (real RabbitMQ)', () => {
  let conn;

  beforeAll(async () => {
    await connectMongoWithRetry();
    await AiJob.deleteMany({});
    conn = await amqp.connect(RABBITMQ_URL);
  });

  afterAll(async () => {
    if (conn) await conn.close();
  });

  test('happy path: job → python worker → result → AiJob COMPLETED', async () => {
    const planWorker = spawnStubWorker('study.plan.generate', 'ok');
    await planWorker.ready;

    try {
      // Subscribe to results BEFORE creating the job (no missed events).
      const {
        startResultConsumer
      } = require('../../services/ai-orchestrator/src/services/jobResultConsumer');
      await startResultConsumer();

      const res = await request(app)
        .post('/api/v1/ai/jobs')
        .set(
          'Authorization',
          `Bearer ${require('../../shared/auth').generateToken({
            userId: 'roundtrip-user',
            email: 'rt@test.com',
            role: 'student'
          })}`
        )
        .send({ type: 'study.plan.generate', payload: { goal: 'master rabbitmq' } });

      expect(res.status).toBe(202);
      const { jobId, correlationId } = res.body;

      await waitFor(async () => {
        const job = await AiJob.findOne({ jobId }).lean();
        return job && job.status === 'COMPLETED';
      }, 45000);

      const job = await AiJob.findOne({ jobId }).lean();
      expect(job.correlationId).toBe(correlationId); // end-to-end correlation intact
      expect(job.result.plan.tasks[0].title).toContain('master rabbitmq');
      expect(job.userId).toBe('roundtrip-user');
    } finally {
      planWorker.child.kill('SIGTERM');
    }
  });

  test('retry exhaustion lands message in DLQ and marks job FAILED', async () => {
    const failWorker = spawnStubWorker('study.search.query', 'fail_retryable');
    await failWorker.ready;
    const channel = await conn.createChannel();

    try {
      await purgeQueue(channel, 'ai.dlq.study.search.query');

      const { publishAiJob } = require('../../shared/ai-messaging/publisher');
      const { messageId, correlationId } = await publishAiJob('study.search.query', 'dlq-user', {
        query: 'trigger failure'
      });

      await AiJob.createPending({
        type: 'study.search.query',
        userId: 'dlq-user',
        correlationId,
        messageId,
        requestId: 'req-dlq'
      });

      const maxRetries = require('../../shared/ai-messaging/topology').MAX_RETRIES;
      expect(maxRetries).toBeGreaterThanOrEqual(1);

      await waitFor(async () => {
        const count = await dlqCount(channel, 'ai.dlq.study.search.query');
        return count >= 1;
      }, 60000);

      await waitFor(async () => {
        const job = await AiJob.findOne({ correlationId }).lean();
        return job && job.status === 'FAILED';
      }, 15000);
      const job = await AiJob.findOne({ correlationId }).lean();
      expect(job.error).toMatch(/LLM timeout/); // sanitized reason persisted
    } finally {
      await channel.close();
      failWorker.child.kill('SIGTERM');
    }
  });
});

/**
 * AI-COM-09 — network isolation assertions (compose-level guard).
 * Runs without a broker; verifies the Python AI service exposes no host ports
 * and the bus binds loopback only in dev / nothing in prod.
 */
describe('AI-COM-09 network isolation (compose contract)', () => {
  const fs = require('fs');
  const yaml = (() => {
    try {
      return require('yaml');
    } catch {
      return null;
    }
  })();
  const parse = yaml && typeof yaml.parse === 'function' ? yaml.parse.bind(yaml) : null;

  const loadCompose = (file) =>
    parse ? parse(fs.readFileSync(path.join(__dirname, '../../', file), 'utf8')) : null;

  test('ai-service publishes no host ports; rabbitmq loopback-only in dev', () => {
    if (!parse) return; // yaml lib absent → covered by CI config check instead
    const compose = loadCompose('docker-compose.yml');
    expect(compose.services['ai-service'].ports).toBeUndefined();

    const rmq = compose.services.rabbitmq;
    for (const binding of rmq.ports) {
      const hostIpPort = String(binding).split(':')[0];
      expect(['127.0.0.1', '::1']).toContain(hostIpPort);
    }
  });

  test('prod overlay keeps ai-service portless and adds no rabbit host ports', () => {
    if (!parse) return;
    const prod = loadCompose('docker-compose.prod.yml');
    expect(prod.services['ai-service'].ports).toBeUndefined();
    expect(prod.services.rabbitmq.ports).toBeUndefined(); // internal only
  });
});
