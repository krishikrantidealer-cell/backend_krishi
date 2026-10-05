const express = require('express');
const router = express.Router();
const controller = require('../controllers/call.controller');
const { protect } = require('../middlewares/auth.middleware');

// Public Webhook Endpoints for MyOperator Calls (No Auth required)
router.post('/webhook', controller.handleCallWebhook);
router.post('/webhooks', controller.handleCallWebhook);
router.post('/webhook/myoperator', controller.handleCallWebhook);
router.post('/webhook/myoperator/calls', controller.handleCallWebhook);
router.post('/webhooks/myoperator', controller.handleCallWebhook);
router.post('/webhooks/myoperator/calls', controller.handleCallWebhook);
router.post('/webhook/call', controller.handleCallWebhook);
router.post('/webhooks/call', controller.handleCallWebhook);
router.post('/webhook/calls', controller.handleCallWebhook);
router.post('/webhooks/calls', controller.handleCallWebhook);
router.post('/webhook/event', controller.handleCallWebhook);
router.post('/webhook/events', controller.handleCallWebhook);
router.post('/callback', controller.handleCallWebhook);
router.post('/events', controller.handleCallWebhook);
router.post('/event', controller.handleCallWebhook);

router.get('/webhook', (req, res) => res.status(200).send('OK'));
router.get('/webhooks', (req, res) => res.status(200).send('OK'));
router.get('/callback', (req, res) => res.status(200).send('OK'));
router.get('/webhook/myoperator', (req, res) => res.status(200).send('OK'));
router.get('/webhook/myoperator/calls', (req, res) => res.status(200).send('OK'));
router.get('/webhooks/myoperator/calls', (req, res) => res.status(200).send('OK'));

// Protected Call Endpoints
router.use(protect);
router.get('/', controller.getCallLogs);
router.get('/logs', controller.getCallLogs);
router.post('/trigger', controller.triggerOutboundCall);
router.post('/outbound', controller.triggerOutboundCall);
router.post('/end', controller.endCall);
router.post('/hangup', controller.endCall);
router.post('/disposition', controller.saveCallDisposition);
router.patch('/:callId/disposition', controller.saveCallDisposition);
router.get('/webrtc/session', controller.getWebRTCSession);
router.get('/recordings/:callId/url', controller.getRecordingPlaybackUrl);
router.put('/agent/status', controller.setAgentStatus);

module.exports = router;
