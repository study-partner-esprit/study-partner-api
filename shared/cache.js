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

    redisClient = {
      isEnabled: true,
      async get(key) {
        try {
          await client.connect();
        } catch {
          // ignore connect errors; ioredis may already be connected
        }
        return client.get(key);
      },
      async setex(key, ttlSeconds, value) {
        try {
          await client.connect();
        } catch {
          // ignore connect errors; ioredis may already be connected
        }
        await client.set(key, value, 'EX', ttlSeconds);
        return true;
      },
      async del(...keys) {
        if (!keys.length) return 0;
        try {
          await client.connect();
        } catch {
          // ignore connect errors; ioredis may already be connected
        }
        return client.del(...keys);
      }
    };

    return redisClient;
  } catch {
    redisUnavailable = true;
    return createNoopClient();
  }
};

module.exports = { getCacheClient };
