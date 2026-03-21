const axios = require('axios');
const SessionChat = require('../models/SessionChat');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function storeQueryMessage({ sessionId, userId, query }) {
  return SessionChat.create({
    sessionId,
    userId,
    messageType: 'query',
    content: query,
    searchQuery: query
  });
}

async function storeResultMessage({ sessionId, userId, query, answer, results }) {
  const normalizedResults = (results || []).slice(0, 10).map((item) => ({
    title: item.title || item.source || 'Result',
    snippet: item.snippet || item.content || '',
    source: item.source || item.url || 'web',
    url: item.url || '',
    relevanceScore: Number(item.relevance_score || item.relevanceScore || 0)
  }));

  return SessionChat.create({
    sessionId,
    userId,
    messageType: 'result',
    content: answer || 'No answer returned.',
    searchQuery: query,
    searchResults: normalizedResults
  });
}

async function runSearch({ question, userId, sessionId }) {
  const response = await axios.post(
    `${AI_SERVICE_URL}/api/ai/search/ask`,
    {
      question,
      user_id: userId,
      session_id: sessionId
    },
    { timeout: 120000 }
  );

  return response.data;
}

async function processSearchQuery({ sessionId, userId, query }) {
  await storeQueryMessage({ sessionId, userId, query });

  const aiResult = await runSearch({ question: query, userId, sessionId });
  const answer = aiResult.answer || aiResult.response || aiResult.summary || '';
  const sources = aiResult.sources || aiResult.results || [];

  const stored = await storeResultMessage({
    sessionId,
    userId,
    query,
    answer,
    results: sources
  });

  return {
    messageId: stored._id,
    sessionId,
    userId,
    question: query,
    answer: stored.content,
    results: stored.searchResults,
    createdAt: stored.createdAt
  };
}

async function getHistory({ sessionId, limit = 50, offset = 0 }) {
  const items = await SessionChat.find({ sessionId })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean();
  return items;
}

async function deleteMessage({ sessionId, messageId, userId }) {
  const message = await SessionChat.findOne({ _id: messageId, sessionId });
  if (!message) return { deleted: false, reason: 'not_found' };
  if (String(message.userId) !== String(userId)) {
    return { deleted: false, reason: 'forbidden' };
  }
  await SessionChat.deleteOne({ _id: messageId });
  return { deleted: true };
}

module.exports = {
  processSearchQuery,
  getHistory,
  deleteMessage
};
