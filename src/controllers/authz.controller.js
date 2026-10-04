const permissionService = require('../services/permissionService');

async function check(req, res, next) {
  try {
    const allowed = await permissionService.checkPermission(req.body);
    res.status(200).json({ allowed });
  } catch (err) {
    next(err);
  }
}

async function checkBulk(req, res, next) {
  try {
    const results = await permissionService.checkPermissionsBulk(req.body);
    res.status(200).json({ results });
  } catch (err) {
    next(err);
  }
}

module.exports = { check, checkBulk };
