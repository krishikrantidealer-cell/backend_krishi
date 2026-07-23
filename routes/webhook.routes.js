const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/webhook.controller');

// MyOperator WABA Webhook — Public endpoint (no auth required; MyOperator POSTs here)
router.post('/myoperator/webhook', handleWebhook);

module.exports = router;
