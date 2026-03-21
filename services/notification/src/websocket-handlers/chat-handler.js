const { processSearchQuery } = require('../services/chatService');

async function handleChatQuery({ ws, payload, context }) {
  const query = (payload?.query || '').trim();
  if (!query) {
    ws.send(JSON.stringify({ type: 'chat_error', error: 'Query is required' }));
    return;
  }

  const { userId, sessionId, broadcastToSession } = context;

  broadcastToSession(sessionId, {
    type: 'chat_query',
    sessionId,
    userId,
    query,
    createdAt: new Date().toISOString()
  });

  try {
    const result = await processSearchQuery({
      sessionId,
      userId,
      query
    });

    broadcastToSession(sessionId, {
      type: 'chat_result',
      sessionId,
      userId,
      ...result
    });
  } catch (err) {
    ws.send(
      JSON.stringify({
        type: 'chat_error',
        error: 'Search request failed',
        details: err.message
      })
    );
  }
}

module.exports = {
  handleChatQuery
};
