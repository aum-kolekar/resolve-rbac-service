const { getPool } = require('../db/pool');
const { fromCode } = require('../errors/AppError');
const permissionCache = require('../cache/permissionCache');

// Postgres error code 22P02 = invalid_text_representation - covers a
// malformed UUID being cast to the `uuid` column type. Internal endpoints
// trust their callers more than public ones, but a caller bug (a
// non-UUID userId/organizationId) shouldn't leak as a raw 500 when it's
// cleanly identifiable as a validation problem.
function isInvalidUuidError(err) {
  return err.code === '22P02';
}

/**
 * The query the hot-path check ultimately runs on a cache miss (Contract
 * §7.1, Schema §2's idx_user_roles_lookup index is what makes this fast):
 * every permission code reachable via any role this user holds in this org.
 */
async function computeFlattenedPermissions(organizationId, userId) {
  try {
    const { rows } = await getPool().query(
      `SELECT DISTINCT p.code
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.organization_id = $1 AND ur.user_id = $2`,
      [organizationId, userId],
    );
    return rows.map((r) => r.code);
  } catch (err) {
    if (isInvalidUuidError(err)) {
      throw fromCode('AUTHZ_VALIDATION_ERROR', 'userId and organizationId must be valid UUIDs.');
    }
    throw err;
  }
}

/**
 * Cache-then-DB per Contract §10. Never throws on a cache miss/failure -
 * only a genuine DB failure propagates.
 */
async function getFlattenedPermissions(organizationId, userId) {
  const cached = await permissionCache.getCachedPermissions(organizationId, userId);
  if (cached) return cached;

  const computed = await computeFlattenedPermissions(organizationId, userId);
  await permissionCache.setCachedPermissions(organizationId, userId, computed);
  return computed;
}

async function permissionCodeExists(code) {
  const { rows } = await getPool().query('SELECT 1 FROM permissions WHERE code = $1', [code]);
  return rows.length > 0;
}

/**
 * POST /internal/v1/authz/check - Contract §7.1.
 * Throws AUTHZ_UNKNOWN_PERMISSION (400) for a permission code that isn't in
 * the catalog at all - deliberately loud, per the contract's own reasoning:
 * this is almost always a caller bug, not a real access decision.
 */
async function checkPermission({ userId, organizationId, permission }) {
  if (!(await permissionCodeExists(permission))) {
    throw fromCode('AUTHZ_UNKNOWN_PERMISSION', `Unknown permission code: ${permission}`);
  }
  const permissions = await getFlattenedPermissions(organizationId, userId);
  return permissions.includes(permission);
}

/** POST /internal/v1/authz/check-bulk - Contract §7.1. */
async function checkPermissionsBulk({ userId, organizationId, permissions: codes }) {
  for (const code of codes) {
    if (!(await permissionCodeExists(code))) {
      throw fromCode('AUTHZ_UNKNOWN_PERMISSION', `Unknown permission code: ${code}`);
    }
  }
  const userPermissions = await getFlattenedPermissions(organizationId, userId);
  const results = {};
  for (const code of codes) {
    results[code] = userPermissions.includes(code);
  }
  return results;
}

async function listPermissionCatalog() {
  const { rows } = await getPool().query('SELECT code, description FROM permissions ORDER BY code');
  return rows;
}

module.exports = {
  getFlattenedPermissions,
  checkPermission,
  checkPermissionsBulk,
  listPermissionCatalog,
  permissionCodeExists,
};
