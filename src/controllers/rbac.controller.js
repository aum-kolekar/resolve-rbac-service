const roleService = require('../services/roleService');
const userRoleService = require('../services/userRoleService');
const permissionService = require('../services/permissionService');
const { fromCode } = require('../errors/AppError');

async function listPermissions(req, res, next) {
  try {
    const permissions = await permissionService.listPermissionCatalog();
    res.status(200).json({ permissions });
  } catch (err) {
    next(err);
  }
}

async function listRoles(req, res, next) {
  try {
    const roles = await roleService.listRoles(req.auth.tenantId);
    res.status(200).json({ roles });
  } catch (err) {
    next(err);
  }
}

async function createRole(req, res, next) {
  try {
    const role = await roleService.createRole(req.auth.tenantId, req.body);
    res.status(201).json(role);
  } catch (err) {
    next(err);
  }
}

async function getRole(req, res, next) {
  try {
    const role = await roleService.getRoleById(req.auth.tenantId, req.params.id);
    res.status(200).json(role);
  } catch (err) {
    next(err);
  }
}

async function updateRole(req, res, next) {
  try {
    const role = await roleService.updateRole(req.auth.tenantId, req.params.id, req.body);
    res.status(200).json(role);
  } catch (err) {
    next(err);
  }
}

async function deleteRole(req, res, next) {
  try {
    await roleService.deleteRole(req.auth.tenantId, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function listUserRoles(req, res, next) {
  try {
    const roles = await userRoleService.listUserRoles(req.auth.tenantId, req.params.userId);
    res.status(200).json({ roles });
  } catch (err) {
    next(err);
  }
}

async function assignUserRole(req, res, next) {
  try {
    const assignment = await userRoleService.assignRole(
      req.auth.tenantId,
      req.params.userId,
      req.body.roleId,
      req.auth.sub,
    );
    res.status(201).json(assignment);
  } catch (err) {
    next(err);
  }
}

async function revokeUserRole(req, res, next) {
  try {
    await userRoleService.revokeRole(req.auth.tenantId, req.params.userId, req.params.roleId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /users/{userId}/permissions - callable by the user about themselves,
 * or by anyone holding ROLE_MANAGE about any user in their tenant
 * (Contract §6). The ROLE_MANAGE check here is inline rather than via the
 * requirePermission middleware, since it's conditional on identity, not
 * unconditionally required.
 */
async function getUserPermissions(req, res, next) {
  try {
    const isSelf = req.auth.sub === req.params.userId;
    if (!isSelf) {
      const allowed = await permissionService.checkPermission({
        userId: req.auth.sub,
        organizationId: req.auth.tenantId,
        permission: 'ROLE_MANAGE',
      });
      if (!allowed) {
        return next(fromCode('AUTHZ_FORBIDDEN', 'Can only view your own permissions without ROLE_MANAGE.'));
      }
    }
    const permissions = await permissionService.getFlattenedPermissions(req.auth.tenantId, req.params.userId);
    return res
      .status(200)
      .json({ userId: req.params.userId, organizationId: req.auth.tenantId, permissions });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listPermissions,
  listRoles,
  createRole,
  getRole,
  updateRole,
  deleteRole,
  listUserRoles,
  assignUserRole,
  revokeUserRole,
  getUserPermissions,
};
