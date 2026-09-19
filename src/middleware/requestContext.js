const { randomUUID } = require('crypto');

function requestContext(req, res, next) {
  req.requestId = `req_${randomUUID().slice(0, 8)}`;
  req.traceId = req.headers['x-trace-id'] || req.requestId;
  res.setHeader('x-request-id', req.requestId);
  next();
}

module.exports = requestContext;
