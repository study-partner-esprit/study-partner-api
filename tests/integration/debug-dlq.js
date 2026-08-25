/* Standalone replica of jest DLQ scenario with verbose diagnostics */
process.env.JWT_SECRET = 'integration-test-secret';
process.env.AI_RETRY_DELAYS_MS = '[100,100,100]';
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const amqp = require('amqplib');

const RABBITMQ_URL = 'amqp://guest:guest@localhost:5672/%2F';
const AI_ROOT = path.join(__dirname, '../../../study-partner-ai');
const QS = [
  'ai.work.study.search.query',
  'ai.dlq.study.search.query',
  'ai.results.inbox',
  'ai.delay.0s'
];

(async () => {
  await mongoose.connect('mongodb://localhost:27017/study_partner_test');
  const AiJob = require('../../services/ai-orchestrator/src/models/AiJob');
  await AiJob.deleteMany({});

  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createChannel();
  await ch.purgeQueue('ai.dlq.study.search.query').catch(() => {});
  await ch.purgeQueue('ai.work.study.search.query').catch(() => {});

  const { startResultConsumer } = require('../../services/ai-orchestrator/src/services/jobResultConsumer');
  await startResultConsumer();

  const child = spawn('python3', ['-m', 'tests.e2e_stub_worker'], {
    cwd: AI_ROOT,
    env: { ...process.env, PYTHONPATH: `${AI_ROOT}:${path.join(AI_ROOT, 'agents/evaluator')}`, JOB_TYPE: 'study.search.query', BEHAVIOR: 'fail_retryable', RABBITMQ_URL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errbuf = '';
  child.stderr.on('data', (c) => { errbuf += c.toString(); });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('not ready ' + errbuf.slice(-400))), 20000);
    child.stdout.on('data', (c) => { if (String(c).includes('STUB_WORKER_READY')) { clearTimeout(t); res(); } });
  });
  console.log('[worker ready]');

  const { publishAiJob } = require('../shared/ai-messaging/publisher'.replace('../shared/', '../../shared/'));
  const { messageId, correlationId } = await publishAiJob('study.search.query', 'dlq-user-standalone', { query: 'fail' });
  await AiJob.createPending({ type: 'study.search.query', userId: 'dlq-user-standalone', correlationId, messageId, requestId: 'r' });
  console.log('[published]', correlationId);

  const snap = async () => {
    const parts = [];
    for (const q of QS) {
      const i = await ch.checkQueue(q).then((x) => x.messageCount).catch(() => 'X');
      parts.push(`${q.replace('ai.', '')}=${i}`);
    }
    return parts.join(' ');
  };

  for (let s = 1; s <= 15; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    const job = await AiJob.findOne({ correlationId }).lean();
    console.log(`[${s}s] job=${job && job.status} ${await snap()}`);
    if (job && job.status === 'FAILED') break;
  }
  if (errbuf.trim()) console.log('[worker.err tail]', errbuf.slice(-600));
  child.kill('SIGTERM');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message || e); process.exit(1); });
