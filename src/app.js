const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');

const logger = require('./utils/logger');
const openapiSpec = require('./docs/openapiSpec');
const requestContext = require('./middleware/requestContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const healthRoutes = require('./routes/health.routes');
const rbacRoutes = require('./routes/rbac.routes');
const authzRoutes = require('./routes/authz.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  // requestContext must run BEFORE the body parser so parse errors still
  // carry a requestId/traceId (Contract §2).
  app.use(requestContext);
  app.use(express.json({ limit: '100kb' }));
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: req.requestId, traceId: req.traceId }),
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  app.use(healthRoutes);
  app.use('/api/v1/rbac', rbacRoutes);
  app.use('/internal/v1/authz', authzRoutes);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  app.get('/docs.json', (req, res) => res.json(openapiSpec));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
