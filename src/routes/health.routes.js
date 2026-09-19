const { Router } = require('express');
const { pingDb } = require('../db/pool');
const { pingRedis } = require('../cache/client');

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'rbac-service' });
});

router.get('/health/ready', async (req, res) => {
  const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);
  // Redis being down only degrades performance (Contract §10) - it does not
  // make this service unready. Postgres being down does, since it's this
  // service's own system of record with no fallback.
  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    status,
    service: 'rbac-service',
    checks: {
      database: dbOk ? 'ok' : 'unreachable',
      redis: redisOk ? 'ok' : 'unreachable (degraded, not down)',
    },
  });
});

module.exports = router;
