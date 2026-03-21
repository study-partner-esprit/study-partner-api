require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const axios = require('axios');
const { WebSocketServer } = require('ws');
const app = require('./app');
const { handleChatQuery } = require('./websocket-handlers/chat-handler');
const {
  handleVoiceSignal,
  handleMuteState,
  handleSpeakingState
} = require('./websocket-handlers/voice-handler');
const { joinParticipant, leaveParticipant } = require('./services/voiceService');
const { normalizeSignalPayload } = require('./utils/rtc-signaling');

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const PORT = process.env.PORT || 3007;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/study_partner';
const USER_PROFILE_URL = process.env.USER_PROFILE_SERVICE_URL || 'http://localhost:3002';

// ── WebSocket client registry ───────────────────────
// Map<userId, Set<WebSocket>>
const clients = new Map();
// Map<sessionId, Map<userId, Set<WebSocket>>>
const sessionClients = new Map();

function broadcastToUser(userId, payload) {
  const userClients = clients.get(userId);
  if (!userClients) return;
  const msg = JSON.stringify(payload);
  for (const ws of userClients) {
    if (ws.readyState === 1) {
      // OPEN
      ws.send(msg);
    }
  }
}

function addRealtimeClient(sessionId, userId, ws) {
  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, new Map());
  }
  const sessionMap = sessionClients.get(sessionId);
  if (!sessionMap.has(userId)) {
    sessionMap.set(userId, new Set());
  }
  sessionMap.get(userId).add(ws);
}

function removeRealtimeClient(sessionId, userId, ws) {
  const sessionMap = sessionClients.get(sessionId);
  if (!sessionMap) return;

  const userSockets = sessionMap.get(userId);
  if (!userSockets) return;

  userSockets.delete(ws);
  if (userSockets.size === 0) {
    sessionMap.delete(userId);
  }
  if (sessionMap.size === 0) {
    sessionClients.delete(sessionId);
  }
}

function broadcastToSession(sessionId, payload) {
  const sessionMap = sessionClients.get(sessionId);
  if (!sessionMap) return;
  const raw = JSON.stringify(payload);

  for (const sockets of sessionMap.values()) {
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        socket.send(raw);
      }
    }
  }
}

// Expose broadcast function so routes can use it
app.locals.broadcastToUser = broadcastToUser;

// Update user online status in user-profile service
async function updateOnlineStatus(userId, status) {
  try {
    await axios.put(`${USER_PROFILE_URL}/api/v1/users/profile/online-status`, {
      userId,
      onlineStatus: status
    });
  } catch (err) {
    logger.warn(`Failed to update online status for ${userId}: ${err.message}`);
  }
}

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 5000),
      connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 5000),
      socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 10000)
    });
    logger.info('Connected to MongoDB');

    const server = http.createServer(app);

    // ── WebSocket Servers (notifications + realtime session) ────────
    const wssNotifications = new WebSocketServer({ noServer: true });
    const wssRealtime = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const requestUrl = new URL(req.url, `http://localhost:${PORT}`);

      if (requestUrl.pathname === '/ws/notifications') {
        wssNotifications.handleUpgrade(req, socket, head, (ws) => {
          wssNotifications.emit('connection', ws, req);
        });
        return;
      }

      if (requestUrl.pathname === '/ws/realtime') {
        wssRealtime.handleUpgrade(req, socket, head, (ws) => {
          wssRealtime.emit('connection', ws, req);
        });
        return;
      }

      socket.destroy();
    });

    wssNotifications.on('connection', (ws, req) => {
      // Expect ?userId=xxx on connect
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const userId = url.searchParams.get('userId');

      if (!userId) {
        ws.close(4001, 'userId required');
        return;
      }

      // Register
      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId).add(ws);
      logger.info(
        `WS client connected for user ${userId} (${clients.get(userId).size} connections)`
      );

      // Set user online when first connection opens
      if (clients.get(userId).size === 1) {
        updateOnlineStatus(userId, 'online');
      }

      // Heartbeat
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle messages (e.g., status updates)
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (
            msg.type === 'status_update' &&
            ['online', 'studying', 'offline'].includes(msg.status)
          ) {
            updateOnlineStatus(userId, msg.status);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on('close', () => {
        const userSet = clients.get(userId);
        if (userSet) {
          userSet.delete(ws);
          if (userSet.size === 0) {
            clients.delete(userId);
            // Set user offline when last connection closes
            updateOnlineStatus(userId, 'offline');
          }
        }
        logger.info(`WS client disconnected for user ${userId}`);
      });

      ws.on('error', (err) => {
        logger.warn(`WS error for user ${userId}: ${err.message}`);
      });
    });

    wssRealtime.on('connection', async (ws, req) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const userId = url.searchParams.get('userId');
      const sessionId = url.searchParams.get('sessionId');

      if (!userId || !sessionId) {
        ws.close(4001, 'userId and sessionId required');
        return;
      }

      ws.sessionId = sessionId;
      ws.userId = userId;
      ws.isAlive = true;

      addRealtimeClient(sessionId, userId, ws);
      await joinParticipant({ sessionId, userId, peerId: userId });

      broadcastToSession(sessionId, {
        type: 'participant_joined',
        sessionId,
        userId,
        createdAt: new Date().toISOString()
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (raw) => {
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON payload' }));
          return;
        }

        const context = {
          userId,
          sessionId,
          broadcastToSession
        };

        try {
          if (payload.type === 'chat_query') {
            await handleChatQuery({ ws, payload, context });
            return;
          }

          if (payload.type === 'voice_signal') {
            await handleVoiceSignal({
              payload: normalizeSignalPayload(payload),
              context
            });
            return;
          }

          if (payload.type === 'voice_mute') {
            await handleMuteState({ payload, context });
            return;
          }

          if (payload.type === 'voice_speaking') {
            await handleSpeakingState({ payload, context });
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      });

      ws.on('close', async () => {
        removeRealtimeClient(sessionId, userId, ws);
        await leaveParticipant({ sessionId, userId });

        broadcastToSession(sessionId, {
          type: 'participant_left',
          sessionId,
          userId,
          createdAt: new Date().toISOString()
        });
      });
    });

    // Heartbeat interval to prune dead connections
    const heartbeatInterval = setInterval(() => {
      const allSockets = [...wssNotifications.clients, ...wssRealtime.clients];
      allSockets.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    wssNotifications.on('close', () => clearInterval(heartbeatInterval));
    wssRealtime.on('close', () => clearInterval(heartbeatInterval));

    server.listen(PORT, () => {
      logger.info(`Notification service listening on port ${PORT}`);
      logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws/notifications`);
      logger.info(`Realtime endpoint: ws://localhost:${PORT}/ws/realtime`);
      logger.info(`Health check: http://localhost:${PORT}/api/v1/health`);
    });
  } catch (error) {
    logger.error('Failed to start notification service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  await mongoose.connection.close();
  process.exit(0);
});

startServer();
