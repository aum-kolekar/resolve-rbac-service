const { Router } = require('express');
const controller = require('../controllers/rbac.controller');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const validateBody = require('../middleware/validateBody');
const { createRoleSchema, updateRoleSchema, assignRoleSchema } = require('../validation/schemas');

const router = Router();

router.use(authenticate);

router.get('/permissions', controller.listPermissions);

router.get('/roles', controller.listRoles);
router.post(
  '/roles',
  requirePermission('ROLE_MANAGE'),
  validateBody(createRoleSchema),
  controller.createRole,
);
router.get('/roles/:id', controller.getRole);
router.patch(
  '/roles/:id',
  requirePermission('ROLE_MANAGE'),
  validateBody(updateRoleSchema),
  controller.updateRole,
);
router.delete('/roles/:id', requirePermission('ROLE_MANAGE'), controller.deleteRole);

router.get('/users/:userId/roles', controller.listUserRoles);
router.post(
  '/users/:userId/roles',
  requirePermission('ROLE_MANAGE'),
  validateBody(assignRoleSchema),
  controller.assignUserRole,
);
router.delete('/users/:userId/roles/:roleId', requirePermission('ROLE_MANAGE'), controller.revokeUserRole);

router.get('/users/:userId/permissions', controller.getUserPermissions);

module.exports = router;
