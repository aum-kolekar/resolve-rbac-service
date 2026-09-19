const createApp = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { closePool } = require('./db/pool');
const { closeRedisClient } = require('./cache/client');

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`rbac-service listening on port ${config.port} (env=${config.env})`);
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    logger.info('HTTP server closed');
    await closePool();
    await closeRedisClient();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
