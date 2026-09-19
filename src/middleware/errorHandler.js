const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'An unexpected error occurred.';

  if (statusCode >= 500) {
    logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  } else {
    logger.warn({ code, requestId: req.requestId }, message);
  }

  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(isAppError && err.details ? { details: err.details } : {}),
      requestId: req.requestId,
      traceId: req.traceId,
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.originalUrl}`,
      requestId: req.requestId,
      traceId: req.traceId,
    },
  });
}

module.exports = { errorHandler, notFoundHandler };
