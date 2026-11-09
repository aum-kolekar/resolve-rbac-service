require('dotenv').config();

function toBool(value) {
  return String(value).toLowerCase() === 'true';
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4300),
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    connectionString: process.env.DATABASE_URL || 'postgres://rbac:rbac@localhost:5432/rbac_service',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'resolve:rbac:',
  },

  cache: {
    permissionTtlSeconds: Number(process.env.PERMISSION_CACHE_TTL_SECONDS || 60),
  },

  auth: {
    useMockJwks: toBool(process.env.USE_MOCK_JWKS ?? 'true'),
    authenticationServiceUrl: process.env.AUTHENTICATION_SERVICE_URL || 'http://localhost:4400',
    internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN || 'dev-internal-service-token',
    // Contract §3: verification must check `iss` matches Authentication Service's issuer.
    issuer: process.env.AUTH_ISSUER || 'resolve-authentication-service',
  },
};

module.exports = config;
