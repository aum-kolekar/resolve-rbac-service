const { fromCode } = require('../errors/AppError');
const { checkPermission } = require('../services/permissionService');

/**
 * Enforces a required permission for RBAC's own management endpoints.
 * Calls the same evaluation logic the internal /authz/check endpoint uses,
 * directly against this service's own database - no HTTP round-trip to
 * itself. This is the pattern Contract §5 documents: "RBAC enforces access
 * to its own management endpoints the same way every other service will
 * eventually enforce access to theirs."
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const allowed = await checkPermission({
        userId: req.auth.sub,
        organizationId: req.auth.tenantId,
        permission,
      });
      if (!allowed) {
        return next(fromCode('AUTHZ_FORBIDDEN', `Missing required permission: ${permission}`));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requirePermission;
