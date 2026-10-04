const { jwtVerify, createRemoteJWKSet } = require('jose');
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
    const { payload } = await jwtVerify(token, getJwks());

    if (payload.type !== 'access') {
      return next(fromCode('AUTHZ_INVALID_TOKEN', 'Token is not an access token.'));
    }

    req.auth = payload; // { sub, tenantId, email, tokenId, type, iat, exp, iss }
    return next();
  } catch (err) {
    if (
      err.code === 'ERR_JWKS_TIMEOUT' ||
      err.code === 'ERR_JWKS_NO_MATCHING_KEY' ||
      err.name === 'JWKSNoMatchingKey'
    ) {
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
