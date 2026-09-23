const express = require('express');
const router = express.Router();
const { verifyMetaWebhook, handleMetaLeadWebhook } = require('../controllers/metaWebhook.controller');
const { handleWebhook: handleMyOperatorWebhook } = require('../controllers/webhook.controller');

// Meta Lead Ads Webhook (supports both /api/meta-lead and /api/webhooks/meta-lead)
router.get('/meta-lead', verifyMetaWebhook);
router.post('/meta-lead', handleMetaLeadWebhook);

router.get('/webhooks/meta-lead', verifyMetaWebhook);
router.post('/webhooks/meta-lead', handleMetaLeadWebhook);

// MyOperator WhatsApp Webhook (supports /api/webhook/myoperator/whatsapp, /api/webhooks/myoperator/whatsapp, and /api/webhook/myoperator)
router.post('/webhook/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/webhooks/myoperator/whatsapp', handleMyOperatorWebhook);
router.post('/webhook/myoperator', handleMyOperatorWebhook);
router.post('/webhooks/myoperator', handleMyOperatorWebhook);
router.get('/webhook/myoperator/whatsapp', (req, res) => res.status(200).send(req.query['hub.challenge'] || 'OK'));

module.exports = router;
