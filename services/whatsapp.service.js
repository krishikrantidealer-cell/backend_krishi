const axios = require('axios');

/**
 * WhatsApp Notification Service (Meta Official Business API)
 * ──────────────────────────────────────────────────────────
 * Enterprise-grade, reliable notifications via Meta Cloud API.
 *
 * REQUIRES:
 * - Meta Business App verification.
 * - Approved Message Templates in Meta WhatsApp Manager.
 */

class WhatsAppService {
  /**
   * Send an official Template Message via Meta Graph API
   * @param {string} phoneNumber - Recipient (with country code, e.g., 919876543210)
   * @param {string} templateName - The name of the approved template in Meta Manager
   * @param {string} languageCode - Default 'en_US'
   * @param {Array} variables - Array of strings to fill {{1}}, {{2}}, etc.
   */
  async sendTemplateMessage(phoneNumber, templateName, languageCode = 'en_US', variables = []) {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) {
      console.warn('[WhatsApp Official] Missing Meta API credentials (TOKEN or PHONE_ID) — skipping.');
      return;
    }

    try {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

      const payload = {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: "body",
              parameters: variables.map(v => ({ type: "text", text: String(v) }))
            }
          ]
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`[WhatsApp Official] ✅ Template "${templateName}" sent to ${cleanPhone}. ID: ${response.data.messages[0].id}`);
      return true;
    } catch (err) {
      console.error(`[WhatsApp Official] ❌ Failed to send template "${templateName}":`, err.response?.data || err.message);
      return false;
    }
  }

  /**
   * Send a free-form text message (Only works if user messaged you in last 24h)
   */
  async sendTextMessage(phoneNumber, message) {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessToken || !phoneNumberId) return;

    try {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

      const response = await axios.post(url, {
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "text",
        text: { body: message }
      }, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      return true;
    } catch (err) {
      console.error('[WhatsApp Official] Text message failed:', err.response?.data || err.message);
      return false;
    }
  }

  // --- AUTOMATED WORKFLOWS ---

  async notifyAbandonedCheckout(user, checkoutSession) {
    if (!user || !user.phoneNumber) return;
    const firstName = user.firstName || 'Customer';
    // Template: abandoned_checkout_hindi (Vars: 1=Name, 2=Link)
    return this.sendTemplateMessage(user.phoneNumber, 'abandoned_checkout_hindi', 'hi', [
      firstName,
      'https://krishikranti.com/cart'
    ]);
  }

  async notifyAbandonedCart(user) {
    if (!user || !user.phoneNumber) return;
    const firstName = user.firstName || 'Customer';
    // Template: abandoned_cart_hindi (Vars: 1=Name, 2=Link)
    return this.sendTemplateMessage(user.phoneNumber, 'abandoned_cart_hindi', 'hi', [
      firstName,
      'https://krishikranti.com/cart'
    ]);
  }

  async notifyOrderSuccessToUser(order, user) {
    if (!user || !user.phoneNumber) return;
    const firstName = user.firstName || 'Customer';
    // Template: order_confirmation_hindi (Vars: 1=Name, 2=OrderID, 3=Amount)
    return this.sendTemplateMessage(user.phoneNumber, 'order_confirmation_hindi', 'hi', [
      firstName,
      order.orderId,
      order.totalAmount
    ]);
  }

  async notifyOrderStatusUpdate(order) {
    // This requires a fetch to get user phone if not in order object
    const User = require('../models/User');
    const user = await User.findById(order.user);
    if (!user || !user.phoneNumber) return;

    // Template: order_status_update (Vars: 1=OrderID, 2=Status)
    return this.sendTemplateMessage(user.phoneNumber, 'order_status_update', 'en_US', [
      order.orderId,
      order.orderStatus
    ]);
  }

  /**
   * Admin Notifications (Still uses template, or can use text if session is open)
   */
  async notifyNewOrder(order, user) {
    const adminPhone = process.env.WHATSAPP_ADMIN_PHONE;
    if (!adminPhone) return;

    const customerName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';

    // Admin templates usually don't need much personalization or can use a generic alert
    return this.sendTemplateMessage(adminPhone, 'admin_new_order_alert', 'en_US', [
      order.orderId,
      customerName,
      order.totalAmount
    ]);
  }
}

module.exports = new WhatsAppService();
