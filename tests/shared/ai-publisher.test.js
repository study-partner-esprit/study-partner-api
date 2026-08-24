/**
 * Unit tests for the AI job publisher (AI-COM-04).
 * amqplib is mocked; no broker required.
 */

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
  test('declares work queue bound to type and its DLQ', async () => {
    await ensureTopologyForType('study.eval.step');

    const ch = amqp.__state.channels[amqp.__state.channels.length - 1];
    expect(ch.assertExchange).toHaveBeenCalledTimes(2); // ai.jobs + ai.dlx

    const queues = ch.assertQueue.mock.calls.map((c) => c[0]);
    expect(queues).toContain('ai.work.study.eval.step');
    expect(queues).toContain('ai.dlq.study.eval.step');

    const workArgs = ch.assertQueue.mock.calls.find(
      (c) => c[0] === 'ai.work.study.eval.step'
    )[1].arguments;
    expect(workArgs['x-dead-letter-exchange']).toBe('ai.dlx');

    expect(ch.bindQueue).toHaveBeenCalledWith(
      'ai.work.study.eval.step',
      EXCHANGE_JOBS,
      'study.eval.step'
    );
    expect(ch.bindQueue).toHaveBeenCalledWith(
      'ai.dlq.study.eval.step',
      'ai.dlx',
      'study.eval.step'
    );
  });
});
