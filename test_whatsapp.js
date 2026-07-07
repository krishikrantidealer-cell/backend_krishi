require('dotenv').config();
const whatsappService = require('./services/whatsapp.service');

(async () => {
  console.log("Sending test WhatsApp notification via Meta Official API...");
  const result = await whatsappService.sendTemplateMessage(
    process.env.WHATSAPP_ADMIN_PHONE,
    'admin_new_order_alert',
    'en_US',
    ['TEST-12345', 'John Doe', '1500']
  );
  console.log("Result:", result);
})();
