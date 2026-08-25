/* Probe: does a message published to ai.delay/100 expire into ai.jobs? */
const amqp = require('amqplib');
(async () => {
  const conn = await amqp.connect('amqp://guest:guest@localhost:5672/%2F');
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange('ai.delay', 'direct', { durable: true });
  await ch.publish('ai.delay', '100', Buffer.from(JSON.stringify({ probe: true })), {
    persistent: true,
    headers: { 'x-probe': 1 }
  });
  await ch.waitForConfirms();
  console.log('[probe published]');
  for (let s = 1; s <= 5; s++) {
    await new Promise((r) => setTimeout(r, 500));
    const w = await ch.checkQueue('ai.work.study.search.query').then((x) => x.messageCount);
    console.log(`[${s}] work.study.search.query=${w}`);
    if (w > 0) break;
  }
  process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
