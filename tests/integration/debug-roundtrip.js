/* Manual round-trip debugger: publishes one job, spawns stub worker, prints everything. */
process.env.JWT_SECRET = 'integration-test-secret';
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const amqp = require('amqplib');

const RABBITMQ_URL = 'amqp://guest:guest@localhost:5672/%2F';
const AI_ROOT = path.join(__dirname, '../../../study-partner-ai');

(async () => {
  await mongoose.connect('mongodb://localhost:27017/study_partner_test');
  const AiJob = require('../../services/ai-orchestrator/src/models/AiJob');
  await AiJob.deleteMany({});

  const child = spawn('python3', ['-m', 'tests.e2e_stub_worker'], {
    cwd: AI_ROOT,
    env: { ...process.env, PYTHONPATH: `${AI_ROOT}:${path.join(AI_ROOT, 'agents/evaluator')}`, JOB_TYPE: 'study.plan.generate', BEHAVIOR: 'ok', RABBITMQ_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => console.log('[worker.out]', c.toString().trim()));
  child.stderr.on('data', (c) => console.log('[worker.err]', c.toString().trim()));
  await new Promise((r) => setTimeout(r, 4000));

  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  for (const q of ['ai.work.study.plan.generate', 'ai.dlq.study.plan.generate', 'ai.results.inbox']) {
    const info = await ch.checkQueue(q).catch(() => null);
    console.log('[queue]', q, info ? info.messageCount : 'MISSING');
  }

  const { publishAiJob } = require('../../shared/ai-messaging/publisher');
  const pub = await publishAiJob('study.plan.generate', 'dbg-user', { goal: 'debug' }, { requestId: 'req-dbg' });
  console.log('[published]', pub);

  const { startResultConsumer } = require('../../services/ai-orchestrator/src/services/jobResultConsumer');
  await startResultConsumer();

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const job = await AiJob.findOne({ correlationId: pub.correlationId }).lean();
    console.log(`[${i}s] status=${job && job.status} error=${job && job.error}`);
    if (job && (job.status === 'COMPLETED' || job.status === 'FAILED')) break;
    for (const q of ['ai.work.study.plan.generate', 'ai.results.inbox']) {
      const info = await ch.checkQueue(q).catch(() => null);
      if (info && info.messageCount) console.log('   [queue]', q, info.messageCount);
    }
  }
  child.kill('SIGTERM');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
