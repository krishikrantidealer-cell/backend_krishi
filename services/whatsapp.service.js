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
  async sendTemplateMessage(phoneNumber, templateName, languageCode = 'hi', variables = []) {
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

  _getUserLanguage(user) {
    if (!user) return 'hi';
    const lang = (user.preferredLanguage || '').toLowerCase();
    if (lang === 'hi' || lang === 'hindi') return 'hi';
    return 'hi';
  }

  async notifyAbandonedCheckout(user, checkoutSession) {
    if (!user || !user.phoneNumber) return;
    const firstName = user.firstName || 'Dealer';
    const lang = this._getUserLanguage(user);

    return this.sendTemplateMessage(user.phoneNumber, 'kd_checkout_reminder_1', lang, [firstName]);
  }

  async notifyAbandonedCart(user) {
    if (!user || !user.phoneNumber) return;
    const firstName = user.firstName || 'Dealer';
    const lang = this._getUserLanguage(user);

    return this.sendTemplateMessage(user.phoneNumber, 'kd_cart_abandoned', lang, [firstName]);
  }

  async notifyOrderSuccessToUser(order, user) {
    if (!user || !user.phoneNumber) return;
    const firstName = user.firstName || 'Dealer';
    const lang = this._getUserLanguage(user);
    const orderId = order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER');
    const amount = String(order.totalAmount || order.payableAmount || 0);

    return this.sendTemplateMessage(user.phoneNumber, 'kd_order_confirmed', lang, [
      firstName,
      orderId,
      amount
    ]);
  }

  async notifyOrderStatusUpdate(order) {
    const User = require('../models/User');
    const user = await User.findById(order.user);
    if (!user || !user.phoneNumber) return;

    const firstName = user.firstName || 'Dealer';
    const lang = this._getUserLanguage(user);
    const orderId = order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER');

    if (order.orderStatus === 'Shipped') {
      const courier = order.trackingDetails?.courierName
        ? `${order.trackingDetails.courierName} (LR: ${order.trackingDetails.trackingNumber || ''})`
        : (order.trackingUrl || 'in Krishi Kranti App');
      return this.sendTemplateMessage(user.phoneNumber, 'kd_order_shipped', lang, [firstName, orderId, courier]);
    } else if (order.orderStatus === 'Delivered') {
      return this.sendTemplateMessage(user.phoneNumber, 'kd_order_delivered', lang, [firstName, orderId]);
    }
  }

  /**
   * Admin Notifications
   */
  async notifyNewOrder(order, user) {
    const adminPhone = process.env.WHATSAPP_ADMIN_PHONE;
    if (!adminPhone) return;

    const customerName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
    return this.sendTemplateMessage(adminPhone, 'kd_order_confirmed', 'en_US', [
      customerName,
      order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER'),
      String(order.totalAmount || 0)
    ]);
  }

  // --- KYC WORKFLOWS ---

  async notifyKycStatusUpdate(user, status, reason = '') {
    if (!user || !user.phoneNumber) return;

    const firstName = user.firstName || 'Dealer';
    const lang = this._getUserLanguage(user);

    if (status === 'verified') {
      return this.sendTemplateMessage(user.phoneNumber, 'kd_kyc_approved', lang, [firstName]);
    } else if (status === 'rejected') {
      return this.sendTemplateMessage(user.phoneNumber, 'kd_incomplete_kyc', lang, [
        firstName,
        reason || 'Uploaded Documents'
      ]);
    }
  }
}

module.exports = new WhatsAppService();
