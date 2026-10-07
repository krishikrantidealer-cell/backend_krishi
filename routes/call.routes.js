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
router.get('/agents', controller.getTelephonyAgents);
router.get('/telephony-agents', controller.getTelephonyAgents);
router.post('/sync', controller.syncCallLogs);
router.get('/sync', controller.syncCallLogs);
router.get('/recordings/:callId/url', controller.getRecordingPlaybackUrl);
router.put('/agent/status', controller.setAgentStatus);

// Soft Delete, Restore & Cleanup Routes
router.delete('/clear', controller.clearAllCallLogs);
router.post('/clear', controller.clearAllCallLogs);
router.delete('/all', controller.clearAllCallLogs);
router.post('/all', controller.clearAllCallLogs);
router.post('/clear-all', controller.clearAllCallLogs);
router.post('/bulk-delete', controller.bulkDeleteCallLogs);
router.delete('/bulk', controller.bulkDeleteCallLogs);
router.delete('/:id', controller.deleteCallLog);
router.post('/:id/delete', controller.deleteCallLog);
router.patch('/:id/restore', controller.restoreCallLog);

module.exports = router;
