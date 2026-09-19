/**
 * Local stand-in for Authentication Service's JWKS endpoint, so rbac-service
 * can be built and tested before a real Authentication Service instance is
 * running alongside it. Generates its own RSA keypair at startup and can
 * sign access tokens shaped exactly like Authentication Service's real
 * ones (Contracts/Authentication_Service.md §3's claim shape), so tests can
 * present a token to rbac-service without a live Authentication Service.
 *
 * Run standalone: `npm run mocks` (listens on :4400, matching .env.example).
 */
const express = require('express');
const { generateKeyPair, exportJWK, SignJWT } = require('jose');

const KID = 'mock-auth-key-1';
const ISSUER = 'resolve-authentication-service';

let keysPromise = null;
function getKeys() {
  if (!keysPromise) {
    keysPromise = generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  }
  return keysPromise;
}

function buildJwksApp() {
  const app = express();

  app.get('/.well-known/jwks.json', async (req, res) => {
    const { publicKey } = await getKeys();
    const jwk = await exportJWK(publicKey);
    jwk.kid = KID;
    jwk.use = 'sig';
    jwk.alg = 'RS256';
    res.status(200).json({ keys: [jwk] });
  });

  return app;
}

/**
 * Signs a token with the SAME shape rbac-service's authenticate middleware
 * expects from a real Authentication Service token - used by tests to
 * simulate "a user already logged in via Authentication Service."
 */
async function signMockAccessToken({
  sub,
  tenantId,
  email,
  tokenId = 'mock-token-id',
  expiresInSeconds = 3600,
}) {
  const { privateKey } = await getKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub, tenantId, email, tokenId, type: 'access' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .setIssuer(ISSUER)
    .sign(privateKey);
}

if (require.main === module) {
  const port = 4400;
  buildJwksApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[mock] Authentication Service JWKS listening on :${port}`);
  });
}

module.exports = { buildJwksApp, signMockAccessToken, KID, ISSUER };
