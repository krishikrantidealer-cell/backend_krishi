const express = require('express');
const router = express.Router();
const { verifyMetaWebhook, handleMetaLeadWebhook } = require('../controllers/metaWebhook.controller');

// Meta Lead Ads Webhook (supports both /api/meta-lead and /api/webhooks/meta-lead)
router.get('/meta-lead', verifyMetaWebhook);
router.post('/meta-lead', handleMetaLeadWebhook);

router.get('/webhooks/meta-lead', verifyMetaWebhook);
router.post('/webhooks/meta-lead', handleMetaLeadWebhook);

module.exports = router;
