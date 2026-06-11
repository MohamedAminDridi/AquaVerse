const Redis  = require('ioredis');
const logger = require('../utils/logger');
let client;

// Redis is an OPTIONAL cache. Connect only when REDIS_URL is explicitly set —
// otherwise skip silently (no localhost fallback: on cloud hosts there is no
// local Redis and the default endless reconnect spammed the logs with
// "[ioredis] Unhandled error event: ECONNREFUSED" forever).
exports.connectRedis = async () => {
  if (!process.env.REDIS_URL) {
    logger.info('Redis: REDIS_URL not set — caching disabled');
    return;
  }
  client = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 3 ? null : 2000),  // 3 tries, then give up
  });
  client.on('error', (e) => logger.warn(`Redis error: ${e.message}`)); // before connect — no unhandled spam
  try {
    await client.connect();
    logger.info('Redis connected');
  } catch (e) {
    logger.warn(`Redis unavailable — caching disabled (${e.message})`);
    client.disconnect();   // stop background reconnect attempts for good
    client = undefined;
  }
};

exports.getRedis = () => {
  if (!client) throw new Error('Redis not initialised');
  return client;
};
