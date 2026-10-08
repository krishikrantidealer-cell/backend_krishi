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
  
  const isWhatsApp = Boolean(
    merged.entry ||
    merged.messages ||
    merged.statuses ||
    merged.text != null ||
    merged.body != null ||
    merged.caption != null ||
    merged.image != null ||
    merged.document != null ||
    merged.video != null ||
    merged.audio != null ||
    merged.voice != null ||
    merged.button_reply != null ||
    merged.list_reply != null ||
    merged.interactive != null ||
    merged.wa_id != null ||
    ['text', 'image', 'document', 'audio', 'video', 'interactive', 'template', 'contacts', 'location'].includes(merged.type) ||
    eventStr.includes('message') ||
    eventStr.includes('whatsapp') ||
    eventStr.includes('template') ||
    eventStr.includes('chat') ||
    eventStr.includes('waba') ||
    ((merged.sender || merged.from || merged.mobile || merged.phone) && (merged.message != null || merged.text != null || merged.body != null))
  );

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
    merged.call_id != null ||
    merged.recording_url != null ||
    merged.legs != null ||
    merged.cli != null ||
    merged.call_status != null ||
    merged.dialstatus != null ||
    merged.duration != null
  );

  req.body = merged;

  if (isCall) {
    return callController.handleCallWebhook(req, res);
  }
  return handleMyOperatorWebhook(req, res);
};

// Universal Webhooks (Auto-routes WhatsApp vs Calls)
router.post('/webhook', dispatchMyOperatorWebhook);
router.post('/webhooks', dispatchMyOperatorWebhook);
router.post('/webhook/myoperator', dispatchMyOperatorWebhook);
router.post('/webhooks/myoperator', dispatchMyOperatorWebhook);

// Explicit WhatsApp Webhooks
router.post('/webhook/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/webhooks/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/conversations/webhook/myoperator', handleMyOperatorWebhook);
router.post('/conversations/webhook/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/whatsapp/webhook', handleMyOperatorWebhook);
router.post('/whatsapp/webhooks', handleMyOperatorWebhook);
router.post('/messages/webhook', handleMyOperatorWebhook);
router.post('/messages/webhooks', handleMyOperatorWebhook);

// Webhook Verifications (GET)
router.get('/webhook', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/webhooks', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/webhook/myoperator/whatsapp', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/webhooks/myoperator/whatsapp', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/webhook/myoperator', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/webhooks/myoperator', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/conversations/webhook/myoperator', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));
router.get('/whatsapp/webhook', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));

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
