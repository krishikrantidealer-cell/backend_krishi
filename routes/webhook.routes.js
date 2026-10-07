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
  const query = req.query || {};
  const merged = { ...query, ...payload, ...(payload.data || payload.details || payload.payload || {}) };

  const eventStr = String(merged.event_type || merged.event || merged.type || merged.action || '').toLowerCase();
  const isWhatsApp = Boolean(merged.entry || merged.messages || merged.statuses || eventStr.includes('message') || eventStr.includes('whatsapp') || eventStr.includes('template'));

  const isCall = !isWhatsApp && (
    eventStr.includes('call') ||
    eventStr.includes('ring') ||
    eventStr.includes('dial') ||
    eventStr.includes('answer') ||
    eventStr.includes('hang') ||
    eventStr.includes('connect') ||
    eventStr.includes('miss') ||
    eventStr.includes('inbound') ||
    eventStr.includes('incoming') ||
    eventStr.includes('outbound') ||
    eventStr.includes('ivr') ||
    merged.cli != null ||
    merged.received_on != null ||
    merged.virtual_number != null ||
    merged.did != null ||
    merged.call_id != null ||
    merged.uid != null ||
    merged.unique_id != null ||
    merged.ref_id != null ||
    merged.client_ref_id != null ||
    merged.session_id != null ||
    merged.duration != null ||
    merged.recording_url != null ||
    merged.legs != null
  );

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
