const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

let pool = null;

function getPool() {
  if (pool) return pool;
  pool = new Pool({ connectionString: config.db.connectionString });
  pool.on('error', (err) => logger.error({ err }, 'Postgres pool: unexpected idle client error'));
  return pool;
}

async function pingDb() {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch (err) {
    logger.warn({ err }, 'Postgres: ping failed');
    return false;
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, pingDb, closePool };
