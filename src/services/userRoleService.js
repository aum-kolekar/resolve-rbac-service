const { getPool } = require('../db/pool');
const { fromCode } = require('../errors/AppError');
const permissionCache = require('../cache/permissionCache');

/** GET /api/v1/rbac/users/{userId}/roles */
async function listUserRoles(organizationId, userId) {
  const { rows } = await getPool().query(
    `SELECT r.id, r.name, r.organization_id, r.is_system_role
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.organization_id = $1 AND ur.user_id = $2
      ORDER BY r.name`,
    [organizationId, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    organizationId: r.organization_id,
    isSystemRole: r.is_system_role,
  }));
}

/**
 * POST /api/v1/rbac/users/{userId}/roles - Contract §6.
 * Does not validate userId exists in User & Team Service - see Contract
 * §7.2 for the explicit reasoning (not a silent omission).
 */
async function assignRole(organizationId, userId, roleId, assignedBy) {
  const pool = getPool();

  const roleCheck = await pool.query(
    `SELECT 1 FROM roles WHERE id = $1 AND (organization_id IS NULL OR organization_id = $2)`,
    [roleId, organizationId],
  );
  if (roleCheck.rows.length === 0) {
    throw fromCode('NOT_FOUND', 'Role not found.');
  }

  const existing = await pool.query(
    'SELECT 1 FROM user_roles WHERE user_id = $1 AND organization_id = $2 AND role_id = $3',
    [userId, organizationId, roleId],
  );
  if (existing.rows.length > 0) {
    throw fromCode('AUTHZ_ROLE_ALREADY_ASSIGNED', 'User already holds this role.');
  }

  const {
    rows: [assignment],
  } = await pool.query(
    `INSERT INTO user_roles (user_id, organization_id, role_id, assigned_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, organizationId, roleId, assignedBy || null],
  );

  await permissionCache.invalidate(organizationId, userId);

  return {
    userId: assignment.user_id,
    organizationId: assignment.organization_id,
    roleId: assignment.role_id,
    assignedBy: assignment.assigned_by,
    assignedAt: assignment.assigned_at,
  };
}

/** DELETE /api/v1/rbac/users/{userId}/roles/{roleId} */
async function revokeRole(organizationId, userId, roleId) {
  const pool = getPool();
  const result = await pool.query(
    'DELETE FROM user_roles WHERE user_id = $1 AND organization_id = $2 AND role_id = $3',
    [userId, organizationId, roleId],
  );
  if (result.rowCount === 0) {
    throw fromCode('NOT_FOUND', 'Role assignment not found.');
  }
  await permissionCache.invalidate(organizationId, userId);
}

module.exports = { listUserRoles, assignRole, revokeRole };
