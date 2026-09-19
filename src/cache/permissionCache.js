const config = require('../config');
const logger = require('../utils/logger');
const { getRedisClient } = require('./client');

function key(organizationId, userId) {
  return `${config.redis.keyPrefix}permissions:${organizationId}:${userId}`;
}

/**
 * Returns the cached flattened permission array, or null on a cache miss
 * OR if Redis itself is unreachable — Contract §10: "Cache is a pure
 * performance optimization, never a source of truth... falls through to a
 * direct database query" rather than failing the request.
 */
async function getCachedPermissions(organizationId, userId) {
  try {
    const raw = await getRedisClient().get(key(organizationId, userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err, organizationId, userId }, 'Permission cache read failed, falling through to DB');
    return null;
  }
}

async function setCachedPermissions(organizationId, userId, permissionCodes) {
  try {
    await getRedisClient().set(
      key(organizationId, userId),
      JSON.stringify(permissionCodes),
      'EX',
      config.cache.permissionTtlSeconds,
    );
  } catch (err) {
    // Cache write failure is not fatal - the check already succeeded against
    // the DB, this only means the NEXT check won't benefit from the cache.
    logger.warn({ err, organizationId, userId }, 'Permission cache write failed');
  }
}

async function invalidate(organizationId, userId) {
  try {
    await getRedisClient().del(key(organizationId, userId));
  } catch (err) {
    logger.warn({ err, organizationId, userId }, 'Permission cache invalidation failed');
  }
}

async function invalidateMany(organizationId, userIds) {
  await Promise.all(userIds.map((userId) => invalidate(organizationId, userId)));
}

module.exports = { getCachedPermissions, setCachedPermissions, invalidate, invalidateMany };
