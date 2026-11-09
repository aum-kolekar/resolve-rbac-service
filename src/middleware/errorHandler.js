const { AppError, fromCode } = require('../errors/AppError');
const logger = require('../utils/logger');

/**
 * Translate errors that are really client mistakes but arrive as plain
 * (non-AppError) exceptions, so they surface as 4xx instead of a misleading 500:
 *  - body-parser: malformed JSON / oversized body
 *  - Postgres 22P02 (invalid_text_representation): a path or body value that
 *    isn't a valid UUID reached a uuid-typed column (e.g. GET /roles/abc)
 */
function normalizeError(err) {
  if (err instanceof AppError) return err;
  if (err.type === 'entity.parse.failed') {
    return fromCode('AUTHZ_VALIDATION_ERROR', 'Request body is not valid JSON.');
  }
  if (err.type === 'entity.too.large') {
    return fromCode('PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }
  if (err.code === '22P02') {
    return fromCode('AUTHZ_VALIDATION_ERROR', 'An identifier in the request is not a valid UUID.');
  }
  return err;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(rawErr, req, res, next) {
  const err = normalizeError(rawErr);
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
