/**
 * Topology parity tests (TEST-04): the Node topology module must match
 * docs/contracts/topology-fixture.json — the same fixture the Python side
 * validates against. Drift fails CI.
 */

const fs = require('fs');
const path = require('path');
const t = require('../../shared/ai-messaging/topology');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../docs/contracts/topology-fixture.json'), 'utf8')
);

describe('RabbitMQ topology parity (Node ↔ fixture ↔ Python)', () => {
  test('exchanges match fixture', () => {
    expect(t.EXCHANGE_JOBS).toBe(fixture.exchanges.jobs);
    expect(t.EXCHANGE_DELAY).toBe(fixture.exchanges.delay);
    expect(t.EXCHANGE_DLX).toBe(fixture.exchanges.dlx);
    expect(t.EXCHANGE_RESULTS).toBe(fixture.exchanges.results);
  });

  test('queue naming matches fixture', () => {
    const n = fixture.naming;
    expect(t.RESULT_QUEUE).toBe(fixture.queues.results);
    expect(t.workQueueName('study.plan.generate')).toBe(n.sampleWorkQueue);
    expect(t.dlqQueueName('study.plan.generate')).toBe(n.sampleDlq);
    expect(t.delayQueueName(1000)).toBe(n.sampleDelayQueue1000);
    expect(t.delayQueueName(16000)).toBe(n.sampleDelayQueue16000);
  });

  test('retry policy matches fixture', () => {
    expect([...t.RETRY_DELAYS_MS]).toEqual(fixture.retryDelaysMs);
    expect(t.MAX_RETRIES).toBe(fixture.maxRetries);
    expect(t.retryHeader).toBe(fixture.headers.retryCount);
  });

  test('classification covers shared semantic cases', () => {
    const { classifyFailure, FAILURE_CLASSES } = t;
    const retryable = [
      Object.assign(new Error('request timeout'), {}),
      Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }),
      new Error('HTTP 503 temporarily unavailable'),
      new Error('rate limit exceeded'),
      new Error('quota exceeded')
    ];
    const terminal = [
      new Error('validation failed'),
      new Error('invalid payload'),
      new Error('unauthorized'),
      new Error('job rejected by validator')
    ];
    for (const e of retryable) expect(classifyFailure(e)).toBe(FAILURE_CLASSES.RETRYABLE);
    for (const e of terminal) expect(classifyFailure(e)).toBe(FAILURE_CLASSES.TERMINAL);
  });
});
