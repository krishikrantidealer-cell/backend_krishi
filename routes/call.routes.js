const express = require('express');
const router = express.Router();
const controller = require('../controllers/call.controller');
const { protect } = require('../middlewares/auth.middleware');

// Public Webhook Endpoint (No Auth required as per MyOperator API spec)
router.post('/webhook/myoperator/calls', controller.handleCallWebhook);

// Protected Call Endpoints
router.use(protect);
router.post('/trigger', controller.triggerOutboundCall);
router.get('/logs', controller.getCallLogs);

module.exports = router;
