const { fromCode } = require('../errors/AppError');

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return next(
        fromCode('AUTHZ_VALIDATION_ERROR', 'Request body failed validation.', result.error.flatten()),
      );
    }
    req.body = result.data;
    return next();
  };
}

module.exports = validateBody;
