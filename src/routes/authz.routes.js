const { Router } = require('express');
const controller = require('../controllers/authz.controller');
const internalAuth = require('../middleware/internalAuth');
const validateBody = require('../middleware/validateBody');
const { authzCheckSchema, authzCheckBulkSchema } = require('../validation/schemas');

const router = Router();

router.use(internalAuth);

router.post('/check', validateBody(authzCheckSchema), controller.check);
router.post('/check-bulk', validateBody(authzCheckBulkSchema), controller.checkBulk);

module.exports = router;
