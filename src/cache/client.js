const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let client = null;

function getRedisClient() {
  if (client) return client;

  client = new Redis(config.redis.url, { maxRetriesPerRequest: 3, lazyConnect: false });
  client.on('connect', () => logger.info('Redis: connected'));
  client.on('error', (err) => logger.error({ err }, 'Redis: connection error'));
  client.on('close', () => logger.warn('Redis: connection closed'));

  return client;
}

async function pingRedis() {
  try {
    const result = await getRedisClient().ping();
    return result === 'PONG';
  } catch (err) {
    logger.warn({ err }, 'Redis: ping failed');
    return false;
  }
}

async function closeRedisClient() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getRedisClient, pingRedis, closeRedisClient };
