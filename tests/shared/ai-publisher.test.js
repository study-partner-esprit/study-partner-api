/**
 * Unit tests for the AI job publisher (AI-COM-04).
 * amqplib is mocked; no broker required.
 */

// Pin retry ladder BEFORE topology loads so queue names are deterministic
// even if the outer shell exports a test override.
process.env.AI_RETRY_DELAYS_MS = '[1000,4000,16000]';

jest.mock('amqplib', () => {
  const state = {
    connection: null,
    confirmChannel: null,
    publishes: [],
    channels: []
  };

  function makeConfirmChannel() {
    const ch = {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
      publish: jest.fn((exchange, routingKey, content, opts) => {
        state.publishes.push({ exchange, routingKey, content, opts });
        return true;
      }),
      waitForConfirms: jest.fn().mockResolvedValue(true),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue({})
    };
    return ch;
  }

  function makeConnection() {
    const conn = {
      // Real amqplib creates a fresh channel per call; mirror that and track
      // every created channel so tests can inspect the last one.
      createConfirmChannel: jest.fn(async () => {
        const ch = makeConfirmChannel();
        state.channels.push(ch);
        state.confirmChannel = ch;
        return ch;
      }),
      createChannel: jest.fn(),
      close: jest.fn().mockResolvedValue({}),
      on: jest.fn()
    };
    return conn;
  }

  const amqp = {
    connect: jest.fn(async () => {
      if (!state.connection) state.connection = makeConnection();
      return state.connection;
    }),
    __state: state
  };
  return amqp;
});

const amqp = require('amqplib');
const {
  publishAiJob,
  ensureTopologyForType,
  closeAiMessaging
} = require('../../shared/ai-messaging/publisher');
const { EXCHANGE_JOBS } = require('../../shared/ai-messaging/topology');

const UUID_A = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

beforeEach(() => {
  amqp.__state.publishes.length = 0;
  amqp.connect.mockClear();
});

afterEach(async () => {
  await closeAiMessaging();
});

describe('publishAiJob (AI-COM-04)', () => {
  test('publishes a valid job envelope to the jobs exchange', async () => {
    const { messageId, correlationId } = await publishAiJob(
      'study.plan.generate',
      'user-1',
      { goal: 'learn graphs' },
      { correlationId: UUID_A, requestId: 'req-1' }
    );

    expect(amqp.__state.publishes).toHaveLength(1);
    const pub = amqp.__state.publishes[0];
    expect(pub.exchange).toBe(EXCHANGE_JOBS);
    expect(pub.routingKey).toBe('study.plan.generate');
    expect(pub.opts.persistent).toBe(true);

    const body = JSON.parse(pub.content.toString());
    expect(body.messageId).toBe(messageId);
    expect(body.correlationId).toBe(UUID_A);
    expect(body.userId).toBe('user-1');
    expect(body.requestId).toBe('req-1');
    expect(body.version).toBe('1');
    expect(typeof body.timestamp).toBe('string');
    expect(messageId).toMatch(/^[0-9a-f-]{36}$/i);

    expect(amqp.__state.confirmChannel.waitForConfirms).toHaveBeenCalled();
  });

  test('rejects an invalid envelope before touching the broker', async () => {
    await expect(publishAiJob('study.plan.generate', '', {})).rejects.toMatchObject({
      code: 'ENVELOPE_INVALID'
    });
    await expect(publishAiJob('not.a.type', 'user-1', {})).rejects.toMatchObject({
      code: 'ENVELOPE_INVALID'
    });
    expect(amqp.__state.publishes).toHaveLength(0);
  });

  test('generates correlationId when not supplied and returns it', async () => {
    const r1 = await publishAiJob('study.search.query', 'u', { query: 'x' });
    const r2 = await publishAiJob('study.search.query', 'u', { query: 'x' });
    expect(r1.correlationId).not.toBe(r2.correlationId);
    expect(r1.messageId).not.toBe(r2.messageId);
  });

  test('surfaces broker non-confirmation as recoverable error (no silent loss)', async () => {
    await publishAiJob('study.coach.nudge', 'u', {});
    amqp.__state.confirmChannel.waitForConfirms.mockResolvedValueOnce(false);
    await expect(publishAiJob('study.coach.nudge', 'u', {})).rejects.toMatchObject({
      code: 'EPUBLISHCONFIRM'
    });
  });
});

describe('ensureTopologyForType', () => {
  test('declares work queue (with retry bindings), per-type delay queues, and DLQ', async () => {
    await ensureTopologyForType('study.eval.step');

    const ch = amqp.__state.channels[amqp.__state.channels.length - 1];
    expect(ch.assertExchange).toHaveBeenCalledTimes(3); // ai.jobs + ai.delay + ai.dlx

    const queues = ch.assertQueue.mock.calls.map((c) => c[0]);
    expect(queues).toContain('ai.work.study.eval.step');
    expect(queues).toContain('ai.dlq.study.eval.step');
    // Per-type delay queues, one per retry step
    expect(queues).toContain('ai.delay.study.eval.step.1000');
    expect(queues).toContain('ai.delay.study.eval.step.4000');
    expect(queues).toContain('ai.delay.study.eval.step.16000');

    const workCall = ch.assertQueue.mock.calls.find(
      (c) => c[0] === 'ai.work.study.eval.step'
    );
    expect(workCall[1].arguments['x-dead-letter-exchange']).toBe('ai.dlx');
    // Terminal dead-letters must route by the bare type even when the
    // message's current key is a retry key.
    expect(workCall[1].arguments['x-dead-letter-routing-key']).toBe('study.eval.step');

    const delayArgs = ch.assertQueue.mock.calls.find(
      (c) => c[0] === 'ai.delay.study.eval.step.1000'
    )[1].arguments;
    expect(delayArgs).toEqual({
      'x-message-ttl': 1000,
      'x-dead-letter-exchange': 'ai.jobs'
    });

    // Primary binding + one extra binding per retry step on the work queue
    expect(ch.bindQueue).toHaveBeenCalledWith(
      'ai.work.study.eval.step',
      EXCHANGE_JOBS,
      'study.eval.step'
    );
    for (const ms of [1000, 4000, 16000]) {
      expect(ch.bindQueue).toHaveBeenCalledWith(
        'ai.delay.study.eval.step.' + ms,
        'ai.delay',
        `retry.study.eval.step.${ms}`
      );
      expect(ch.bindQueue).toHaveBeenCalledWith(
        'ai.work.study.eval.step',
        EXCHANGE_JOBS,
        `retry.study.eval.step.${ms}`
      );
    }
    expect(ch.bindQueue).toHaveBeenCalledWith(
      'ai.dlq.study.eval.step',
      'ai.dlx',
      'study.eval.step'
    );
  });
});
