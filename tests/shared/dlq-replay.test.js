/**
 * Unit tests for the DLQ replay tool (AI-COM-06 ops completion).
 * No broker required — the channel is a scripted fake.
 */

const { replayDeadLetters } = require('../../shared/ai-messaging/dlq-replay');
const { EXCHANGE_JOBS, retryHeader } = require('../../shared/ai-messaging/topology');

function fakeMessage({ body = '{"x":1}', messageId, correlationId, headers = {} } = {}) {
  return {
    content: Buffer.from(body),
    properties: {
      contentType: 'application/json',
      messageId,
      correlationId,
      headers: { ...headers }
    }
  };
}

function fakeChannel(queueContents) {
  const pending = [...queueContents];
  const state = { published: [], acked: [], nacked: [] };
  const ch = {
    publish(exchange, rk, content, opts) {
      state.published.push({ exchange, rk, content, opts });
    },
    ack(msg) {
      state.acked.push(msg);
    },
    nack(msg, all, requeue) {
      state.nacked.push({ msg, all, requeue });
    },
    async get(q) {
      if (q !== 'ai.dlq.study.search.query') throw new Error('wrong queue ' + q);
      return pending.length ? pending.shift() : null;
    }
  };
  return { ch, state };
}

describe('replayDeadLetters', () => {
  test('republishes to jobs exchange under the bare type with a FRESH messageId', async () => {
    const msg = fakeMessage({
      messageId: 'orig-id',
      correlationId: 'corr-1',
      headers: { [retryHeader]: 2, 'x-last-failure': 'boom' }
    });
    const { ch, state } = fakeChannel([msg]);

    const res = await replayDeadLetters(ch, { type: 'study.search.query' });

    expect(res).toEqual({ inspected: 1, replayed: 1, dryRun: false });
    expect(state.published[0].exchange).toBe(EXCHANGE_JOBS);
    expect(state.published[0].rk).toBe('study.search.query');
    const pub = state.published[0];
    // Fresh id (never equal to original) → fresh idempotency claim
    expect(pub.opts.messageId).toBeDefined();
    expect(pub.opts.messageId).not.toBe('orig-id');
    expect(pub.opts.correlationId).toBe('corr-1'); // preserved for AiJob correlation
    // Retry bookkeeping stripped; audit trail added
    expect(pub.opts.headers[retryHeader]).toBeUndefined();
    expect(pub.opts.headers['x-last-failure']).toBeUndefined();
    expect(pub.opts.headers['x-original-message-id']).toBe('orig-id');
    expect(pub.opts.headers['x-replayed-from']).toBe('ai.dlq.study.search.query');
    expect(state.acked).toHaveLength(1);
  });

  test('dry-run inspects without publishing and requeues untouched', async () => {
    const { ch, state } = fakeChannel([
      fakeMessage({ messageId: 'a' }),
      fakeMessage({ messageId: 'b' })
    ]);

    const res = await replayDeadLetters(ch, { type: 'study.search.query', dryRun: true });

    expect(res).toEqual({ inspected: 2, replayed: 0, dryRun: true });
    expect(state.published).toHaveLength(0);
    expect(state.acked).toHaveLength(0);
    expect(state.nacked).toHaveLength(2);
    expect(state.nacked.every((n) => n.requeue === true)).toBe(true);
  });

  test('respects limit and stops at empty queue', async () => {
    const msgs = [fakeMessage(), fakeMessage(), fakeMessage()];
    const { ch, state } = fakeChannel(msgs);

    const res = await replayDeadLetters(ch, { type: 'study.search.query', limit: 2 });
    expect(res.inspected).toBe(2);

    const drained = await replayDeadLetters(ch, { type: 'study.search.query' });
    expect(drained.inspected).toBe(1); // the leftover third message
    expect(state.acked).toHaveLength(3);
  });

  test('empty DLQ is a no-op', async () => {
    const { ch, state } = fakeChannel([]);
    const res = await replayDeadLetters(ch, { type: 'study.search.query' });
    expect(res.inspected).toBe(0);
    expect(state.published).toHaveLength(0);
  });

  test('missing type throws', async () => {
    const { ch } = fakeChannel([]);
    await expect(replayDeadLetters(ch, {})).rejects.toThrow('job type');
  });
});
