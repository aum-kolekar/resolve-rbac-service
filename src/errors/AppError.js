class AppError extends Error {
  constructor(code, message, statusCode, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Error code catalog — Contracts/RBAC_Service.md §8.
const ErrorCodes = Object.freeze({
  AUTHZ_INVALID_TOKEN: { status: 401 },
  AUTHZ_FORBIDDEN: { status: 403 },
  AUTHZ_SYSTEM_ROLE_IMMUTABLE: { status: 403 },
  AUTHZ_UNKNOWN_PERMISSION: { status: 400 },
  AUTHZ_ROLE_NAME_CONFLICT: { status: 409 },
  AUTHZ_ROLE_ALREADY_ASSIGNED: { status: 409 },
  AUTHZ_VALIDATION_ERROR: { status: 400 },
  NOT_FOUND: { status: 404 },
  INTERNAL_ERROR: { status: 500 },
  DEPENDENCY_UNAVAILABLE: { status: 503 },
});

function fromCode(code, message, details) {
  const entry = ErrorCodes[code] || ErrorCodes.INTERNAL_ERROR;
  return new AppError(code, message, entry.status, details);
}

module.exports = { AppError, ErrorCodes, fromCode };
