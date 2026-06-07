let redisClient = null;
let redisUnavailable = false;

const REDIS_URL = process.env.REDIS_URL || '';

const createNoopClient = () => ({
  isEnabled: false,
  async get() {
    return null;
  },
  async setex() {
    return false;
  },
  async del() {
    return 0;
  }
});

const getCacheClient = () => {
  if (!REDIS_URL || redisUnavailable) {
    return createNoopClient();
  }

  if (redisClient) {
    return redisClient;
  }

  try {
    // Lazy require allows services to run without redis package when cache is disabled.
    // eslint-disable-next-line global-require
    const Redis = require('ioredis');
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true
    });

    client.on('error', () => {
      redisUnavailable = true;
    });

    const safely = async (fn) => {
      try {
        if (client.status !== 'ready' && client.status !== 'connecting') {
          try { await client.connect(); } catch { /* will throw below */ }
        }
        return await fn();
      } catch (err) {
        redisUnavailable = true;
        redisClient = null;
        client.disconnect();
        return null;
      }
    };

    redisClient = {
      isEnabled: true,
      async get(key) {
        const result = await safely(() => client.get(key));
        return result;
      },
      async setex(key, ttlSeconds, value) {
        const result = await safely(() => client.set(key, value, 'EX', ttlSeconds));
        return result !== null;
      },
      async del(...keys) {
        if (!keys.length) return 0;
        const result = await safely(() => client.del(...keys));
        return typeof result === 'number' ? result : 0;
      }
    };

    return redisClient;
  } catch {
    redisUnavailable = true;
    return createNoopClient();
  }
};

module.exports = { getCacheClient };
