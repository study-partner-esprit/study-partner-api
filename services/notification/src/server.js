require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const axios = require('axios');
const { WebSocketServer } = require('ws');
const app = require('./app');

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

    // ── WebSocket Server on same HTTP server ────────
    const wss = new WebSocketServer({ server, path: '/ws/notifications' });

    wss.on('connection', (ws, req) => {
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

    // Heartbeat interval to prune dead connections
    const heartbeatInterval = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    wss.on('close', () => clearInterval(heartbeatInterval));

    server.listen(PORT, () => {
      logger.info(`Notification service listening on port ${PORT}`);
      logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws/notifications`);
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
