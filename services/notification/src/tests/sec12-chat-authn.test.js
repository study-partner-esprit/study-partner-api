/**
 * SEC-12 — chat (notification service) authentication regression.
 *
 * Mounts the chat router behind the real `authenticate` middleware and proves
 * unauthenticated and expired tokens are rejected and that the delete-message
 * path honours the ownership check (403 for forbidden deletes).
 */
process.env.JWT_SECRET = 'sec12-chat-secret';
process.env.JWT_REFRESH_SECRET = 'sec12-chat-refresh';
process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
process.env.INTERNAL_API_SECRET = 'sec12-chat-internal';
process.env.RABBITMQ_URL = 'amqp://localhost:5672/%2F';
process.env.NODE_ENV = 'test';
process.exit = jest.fn();

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { authenticate } = require('@study-partner/shared/auth');
const { errorHandler } = require('@study-partner/shared/middleware');

const chatRouter = require('../routes/chat');

jest.mock('../services/chatService', () => ({
  processSearchQuery: jest.fn().mockResolvedValue({ answer: 'ok', message: undefined }),
  getHistory: jest.fn().mockResolvedValue([{ messageId: 'm-1', sender: 'user-alice', text: 'hi' }]),
  deleteMessage: jest.fn()
}));
jest.mock('@study-partner/shared', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const chatService = require('../services/chatService');

const app = express();
app.use(express.json());
app.use('/api/v1/session-chat', authenticate, chatRouter);
app.use(errorHandler);

const alice = { userId: 'user-alice', email: 'alice@test.com', role: 'student', isActive: true };

function authHeader(payload = alice, secret = process.env.JWT_SECRET) {
  return { Authorization: `Bearer ${jwt.sign(payload, secret)}` };
}

function expiredToken() {
  return jwt.sign({ ...alice, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
}

beforeEach(() => jest.clearAllMocks());

describe('SEC-12 chat endpoints require valid authentication', () => {
  it('401 without a token', async () => {
    const res = await request(app).get('/api/v1/session-chat/session-1/history');
    expect(res.status).toBe(401);
  });

  it('401 with a valid-looking but wrong-secret token', async () => {
    const res = await request(app)
      .get('/api/v1/session-chat/session-1/history')
      .set(authHeader(alice, 'sec12-wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('401 with an expired token', async () => {
    const res = await request(app)
      .get('/api/v1/session-chat/session-1/history')
      .set('Authorization', `Bearer ${expiredToken()}`);
    expect(res.status).toBe(401);
  });

  it('403 when a message delete is forbidden (not the message owner)', async () => {
    chatService.deleteMessage.mockResolvedValueOnce({ deleted: false, reason: 'forbidden' });

    const res = await request(app)
      .delete('/api/v1/session-chat/session-1/message-id-9')
      .set(authHeader());

    expect(res.status).toBe(403);
    expect(chatService.deleteMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      messageId: 'message-id-9',
      userId: 'user-alice'
    });
  });

  it('200 for an authenticated valid-history read', async () => {
    const res = await request(app).get('/api/v1/session-chat/session-1/history').set(authHeader());

    expect(res.status).toBe(200);
    expect(chatService.getHistory).toHaveBeenCalledWith({
      sessionId: 'session-1',
      limit: 50,
      offset: 0
    });
  });
});
