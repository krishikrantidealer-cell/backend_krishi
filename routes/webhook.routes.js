const express = require('express');
const router = express.Router();
const { verifyMetaWebhook, handleMetaLeadWebhook } = require('../controllers/metaWebhook.controller');
const { handleWebhook: handleMyOperatorWebhook } = require('../controllers/webhook.controller');
const callController = require('../controllers/call.controller');

// Meta Lead Ads Webhook (supports both /api/meta-lead and /api/webhooks/meta-lead)
router.get('/meta-lead', verifyMetaWebhook);
router.post('/meta-lead', handleMetaLeadWebhook);
router.get('/webhooks/meta-lead', verifyMetaWebhook);
router.post('/webhooks/meta-lead', handleMetaLeadWebhook);

// Universal MyOperator Webhook Handler (Auto-dispatches Call Events vs WhatsApp Messages)
const dispatchMyOperatorWebhook = (req, res) => {
  const payload = req.body || {};
  const data = payload.data || payload.details || {};
  const isCall = (payload.event_type && String(payload.event_type).toLowerCase().includes('call')) ||
                 (payload.event && String(payload.event).toLowerCase().includes('call')) ||
                 (payload.type && String(payload.type).toLowerCase().includes('call')) ||
                 !!payload.call_id || !!data.call_id ||
                 !!payload.customer_number || !!data.customer_number ||
                 payload.duration !== undefined || data.duration !== undefined ||
                 !!payload.recording_url || !!data.recording_url;

  if (isCall) {
    return callController.handleCallWebhook(req, res);
  }
  return handleMyOperatorWebhook(req, res);
};

router.post('/webhook', dispatchMyOperatorWebhook);
router.post('/webhooks', dispatchMyOperatorWebhook);
router.post('/webhook/myoperator', dispatchMyOperatorWebhook);
router.post('/webhooks/myoperator', dispatchMyOperatorWebhook);
router.post('/webhook/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/webhooks/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/conversations/webhook/myoperator', handleMyOperatorWebhook);
router.post('/conversations/webhook/myoperator/whatsapp', handleMyOperatorWebhook);

router.get('/webhook/myoperator/whatsapp', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/webhook/myoperator', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/conversations/webhook/myoperator', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));

// MyOperator Calling Webhook (supports /api/calls/webhook/myoperator, /api/webhooks/myoperator/calls, etc.)
router.post('/calls/webhook/myoperator', callController.handleCallWebhook);
router.post('/calls/webhook/myoperator/calls', callController.handleCallWebhook);
router.post('/calls/webhooks/myoperator', callController.handleCallWebhook);
router.post('/calls/webhooks/myoperator/calls', callController.handleCallWebhook);
router.post('/webhooks/myoperator/calls', callController.handleCallWebhook);
router.post('/webhook/myoperator/calls', callController.handleCallWebhook);
router.get('/calls/webhook/myoperator', (req, res) => res.status(200).send('OK'));
router.get('/webhooks/myoperator/calls', (req, res) => res.status(200).send('OK'));

module.exports = router;
