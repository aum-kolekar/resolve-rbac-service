const config = require('../config');
const { fromCode } = require('../errors/AppError');

function internalAuth(req, res, next) {
  const token = req.headers['x-internal-service-token'];
  if (!token || token !== config.auth.internalServiceToken) {
    return next(fromCode('AUTHZ_INVALID_TOKEN', 'Missing or invalid internal service token.'));
  }
  return next();
}

module.exports = internalAuth;
