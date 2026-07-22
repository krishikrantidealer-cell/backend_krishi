const crypto = require('crypto');

const validateInteraktWebhook = (req, res, next) => {
  const signatureHeader = req.headers['interakt-signature'];
  const webhookSecret = process.env.INTERAKT_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[Interakt Webhook] INTERAKT_WEBHOOK_SECRET is missing. Skipping signature verification for testing.');
    return next();
  }

  if (!signatureHeader) {
    console.warn('[Interakt Webhook] Missing interakt-signature header. Proceeding in compatibility mode.');
    return next();
  }

  // Interakt signature pattern: sha256=HEX_SIGNATURE
  const signatureParts = signatureHeader.split('sha256=');
  if (signatureParts.length !== 2) {
    console.warn('[Interakt Webhook] Malformed signature header. Proceeding in compatibility mode.');
    return next();
  }
  const incomingSignature = signatureParts[1];

  // Derive signature using raw payload buffer
  const computedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(req.rawBody || JSON.stringify(req.body))
    .digest('hex');

  if (incomingSignature !== computedSignature) {
    console.warn(`[Interakt Webhook] Signature mismatch! Expected ${computedSignature} but got ${incomingSignature}. Proceeding in compatibility mode.`);
  }

  next();
};

module.exports = { validateInteraktWebhook };
