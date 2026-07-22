const express = require('express');
const router = express.Router();
const { handleWebhook } = require('../controllers/webhook.controller');
const { validateInteraktWebhook } = require('../middlewares/webhook.middleware');

// Public webhook route secured by HMAC SHA-256 header validation
router.post('/interakt/webhook', validateInteraktWebhook, handleWebhook);

module.exports = router;
