require('dotenv').config();
const whatsappService = require('./services/whatsapp.service');

(async () => {
  console.log("Sending test WhatsApp notification via Green-API...");
  const result = await whatsappService.sendToAdmin("🔔 *Krishi Kranti Test Alert* 🔔\n\nGreen-API WhatsApp Integration is working successfully!");
  console.log("Result:", result);
})();
