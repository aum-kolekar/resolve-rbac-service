const { getPool } = require('../db/pool');
const { fromCode } = require('../errors/AppError');
const { permissionCodeExists } = require('./permissionService');
const permissionCache = require('../cache/permissionCache');

async function attachPermissions(pool, role) {
  const { rows } = await pool.query(
    `SELECT p.code FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.code`,
    [role.id],
  );
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    organizationId: role.organization_id,
    isSystemRole: role.is_system_role,
    permissions: rows.map((r) => r.code),
  };
}

/** GET /api/v1/rbac/roles - global system roles + this tenant's own custom roles, never another tenant's. */
async function listRoles(organizationId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM roles WHERE organization_id IS NULL OR organization_id = $1 ORDER BY name`,
    [organizationId],
  );
  return Promise.all(rows.map((role) => attachPermissions(pool, role)));
}

/**
 * GET /api/v1/rbac/roles/{id} - a custom role belonging to a different
 * tenant is treated identically to a nonexistent role (anti-enumeration,
 * Contract §6).
 */
async function getRoleById(organizationId, roleId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM roles WHERE id = $1 AND (organization_id IS NULL OR organization_id = $2)`,
    [roleId, organizationId],
  );
  if (rows.length === 0) {
    throw fromCode('NOT_FOUND', 'Role not found.');
  }
  return attachPermissions(pool, rows[0]);
}

async function validatePermissionCodes(codes) {
  for (const code of codes) {
    if (!(await permissionCodeExists(code))) {
      throw fromCode('AUTHZ_UNKNOWN_PERMISSION', `Unknown permission code: ${code}`);
    }
  }
}

/** POST /api/v1/rbac/roles - always scoped to the caller's own tenant. */
async function createRole(organizationId, { name, description, permissionCodes }) {
  await validatePermissionCodes(permissionCodes || []);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conflict = await client.query(
      `SELECT 1 FROM roles WHERE name = $1 AND (organization_id IS NULL OR organization_id = $2)`,
      [name, organizationId],
    );
    if (conflict.rows.length > 0) {
      throw fromCode('AUTHZ_ROLE_NAME_CONFLICT', `A role named "${name}" already exists in this tenant.`);
    }

    const {
      rows: [role],
    } = await client.query(
      `INSERT INTO roles (organization_id, name, description, is_system_role)
       VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [organizationId, name, description || null],
    );

    for (const code of permissionCodes || []) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE code = $2`,
        [role.id, code],
      );
    }

    await client.query('COMMIT');
    return attachPermissions(pool, role);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function assertRoleEditable(pool, organizationId, roleId) {
  const { rows } = await pool.query(
    `SELECT * FROM roles WHERE id = $1 AND (organization_id IS NULL OR organization_id = $2)`,
    [roleId, organizationId],
  );
  if (rows.length === 0) {
    throw fromCode('NOT_FOUND', 'Role not found.');
  }
  if (rows[0].is_system_role) {
    throw fromCode('AUTHZ_SYSTEM_ROLE_IMMUTABLE', 'System roles cannot be modified.');
  }
  return rows[0];
}

/**
 * PATCH /api/v1/rbac/roles/{id}. Invalidates the permission cache for every
 * user who holds this role (Contract §10) - a permission-set edit must not
 * leave stale grants cached for up to 60 seconds after being tightened.
 */
async function updateRole(organizationId, roleId, { name, description, permissionCodes }) {
  const pool = getPool();
  await assertRoleEditable(pool, organizationId, roleId);

  if (permissionCodes) {
    await validatePermissionCodes(permissionCodes);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (name !== undefined) {
      const conflict = await client.query(
        `SELECT 1 FROM roles WHERE name = $1 AND id != $2 AND (organization_id IS NULL OR organization_id = $3)`,
        [name, roleId, organizationId],
      );
      if (conflict.rows.length > 0) {
        throw fromCode('AUTHZ_ROLE_NAME_CONFLICT', `A role named "${name}" already exists in this tenant.`);
      }
    }

    const {
      rows: [updated],
    } = await client.query(
      `UPDATE roles SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         updated_at = now()
       WHERE id = $3 RETURNING *`,
      [name ?? null, description ?? null, roleId],
    );

    if (permissionCodes) {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const code of permissionCodes) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, id FROM permissions WHERE code = $2`,
          [roleId, code],
        );
      }
    }

    const affectedUsers = await client.query('SELECT DISTINCT user_id FROM user_roles WHERE role_id = $1', [
      roleId,
    ]);

    await client.query('COMMIT');

    await permissionCache.invalidateMany(
      organizationId,
      affectedUsers.rows.map((r) => r.user_id),
    );

    return attachPermissions(pool, updated);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** DELETE /api/v1/rbac/roles/{id} - cascades to user_roles (Contract §6). */
async function deleteRole(organizationId, roleId) {
  const pool = getPool();
  await assertRoleEditable(pool, organizationId, roleId);

  const affectedUsers = await pool.query('SELECT DISTINCT user_id FROM user_roles WHERE role_id = $1', [
    roleId,
  ]);

  await pool.query('DELETE FROM roles WHERE id = $1', [roleId]);

  await permissionCache.invalidateMany(
    organizationId,
    affectedUsers.rows.map((r) => r.user_id),
  );
}

module.exports = { listRoles, getRoleById, createRole, updateRole, deleteRole };
