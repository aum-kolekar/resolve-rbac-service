const { jwtVerify, createRemoteJWKSet, errors } = require('jose');
const config = require('../config');
const { fromCode } = require('../errors/AppError');

/**
 * jose's createRemoteJWKSet handles fetch + cache + refresh-on-kid-miss
 * internally - this is exactly the "fetch and cache Authentication's JWKS"
 * pattern Contract §3 describes every other service using, without this
 * service needing to reimplement caching logic itself.
 */
let jwks = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${config.auth.authenticationServiceUrl}/.well-known/jwks.json`));
  }
  return jwks;
}

// Network-level failures reaching Authentication Service's JWKS endpoint. These
// are a dependency outage (503), NOT a bad token (401). Deliberately excludes
// "no key matches this kid": that's what a forged/garbage token looks like and
// must stay a 401 - reporting it as an outage would be both wrong and a handy
// way to make the service look broken.
const JWKS_UNAVAILABLE_CODES = new Set([
  'ERR_JWKS_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);
function isJwksUnavailable(err) {
  if (err instanceof errors.JWKSTimeout) return true;
  if (JWKS_UNAVAILABLE_CODES.has(err.code)) return true;
  // Non-200 from the JWKS endpoint itself (e.g. Authentication Service is up but unhealthy).
  return typeof err.message === 'string' && err.message.includes('Expected 200 OK from the JSON Web Key Set');
}

/**
 * Contract §3's verification: signature (via the fetched public key),
 * exp, and that this is an access token, not a refresh token misused as
 * a bearer credential. Does NOT check Authentication's revocation list -
 * Contract §3 explicitly documents this as a known, bounded latency
 * window, not an oversight.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(fromCode('AUTHZ_INVALID_TOKEN', 'Missing or malformed Authorization header.'));
  }
  const token = header.slice('Bearer '.length);

  try {
    const { payload } = await jwtVerify(token, getJwks(), { issuer: config.auth.issuer });

    if (payload.type !== 'access') {
      return next(fromCode('AUTHZ_INVALID_TOKEN', 'Token is not an access token.'));
    }

    req.auth = payload; // { sub, tenantId, email, tokenId, type, iat, exp, iss }
    return next();
  } catch (err) {
    if (isJwksUnavailable(err)) {
      return next(fromCode('DEPENDENCY_UNAVAILABLE', 'Authentication Service is temporarily unavailable.'));
    }
    return next(
      fromCode('AUTHZ_INVALID_TOKEN', 'Access token is missing, malformed, expired, or invalid.', {
        cause: err.message,
      }),
    );
  }
}

// Test-only: force a fresh JWKS client (e.g. after pointing config at a
// different mock server between test files).
function _resetJwksForTests() {
  jwks = null;
}

module.exports = { authenticate, _resetJwksForTests };
