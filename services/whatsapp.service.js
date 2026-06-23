const axios = require('axios');

/**
 * WhatsApp Notification Service (Green-API)
 * ─────────────────────────────────────────
 * Free, zero-cost WhatsApp notifications sent to ONE admin number.
 *
 * Credentials stored in .env:
 *   WHATSAPP_ADMIN_PHONE=919XXXXXXXXX   (your number with country code, no +)
 *   GREEN_API_URL=https://XXXX.api.greenapi.com
 *   GREEN_API_INSTANCE_ID=XXXXXXXXXX
 *   GREEN_API_TOKEN=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
 */

class WhatsAppService {
  /**
   * Send a WhatsApp message to the admin number via Green-API.
   * @param {string} message - Plain text message to send
   */
  async sendToAdmin(message) {
    const phone = process.env.WHATSAPP_ADMIN_PHONE;
    const apiUrl = process.env.GREEN_API_URL;
    const idInstance = process.env.GREEN_API_INSTANCE_ID;
    const apiTokenInstance = process.env.GREEN_API_TOKEN;

    if (!phone || !apiUrl || !idInstance || !apiTokenInstance) {
      console.warn('[WhatsApp] Green-API credentials or WHATSAPP_ADMIN_PHONE not fully configured — skipping.');
      return;
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const chatId = `${cleanPhone}@c.us`;
      const url = `${apiUrl}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;

      const response = await axios.post(url, {
        chatId,
        message
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`[WhatsApp] ✅ Notification sent via Green-API. Status: ${response.status}`);
      return true;
    } catch (err) {
      // Never throw — WhatsApp failure should NOT affect core order flow
      console.error('[WhatsApp] ❌ Failed to send notification via Green-API:', err.response?.data || err.message);
      return false;
    }
  }

  /**
   * Notify admin about a newly placed order.
   * @param {object} order   - Mongoose Order document
   * @param {object} user    - User document with name, phone, shopName
   */
  async notifyNewOrder(order, user) {
    const customerName = user
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Unknown'
      : 'Unknown';
    const phone = user?.phoneNumber || 'N/A';
    const shopName = user?.shopName || 'N/A';

    // Build items summary
    const itemLines = (order.items || [])
      .map(i => `  • ${i.title} x${i.quantity} — ₹${(i.price * i.quantity).toFixed(0)}`)
      .join('\n');

    const freeLines = (order.freeItems || [])
      .map(f => `  • ${f.name} x${f.quantity || 1} (🎁 Free)`)
      .join('\n');

    const allItems = [itemLines, freeLines].filter(Boolean).join('\n');

    const paymentInfo = order.paymentMethod === 'Partial'
      ? `Partial — Advance ₹${order.advanceAmount}, Remaining ₹${order.remainingAmount}`
      : `${order.paymentMethod} (${order.paymentStatus})`;

    const addr = order.shippingAddress || {};
    const address = [addr.villageArea, addr.cityTehsil, addr.state, addr.pincode]
      .filter(Boolean).join(', ') || 'N/A';

    const couponLine = order.couponCode
      ? `\n🏷️ Coupon: ${order.couponCode} (Saved ₹${order.discountAmount || 0})`
      : '';

    const message =
      `🛒 *NEW ORDER RECEIVED* 🛒\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 Order ID: ${order.orderId}\n` +
      `📅 Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 Customer: ${customerName}\n` +
      `📱 Phone: ${phone}\n` +
      `🏪 Shop: ${shopName}\n` +
      `📍 Address: ${address}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 Items:\n${allItems}${couponLine}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 Total: ₹${order.totalAmount}\n` +
      `💳 Payment: ${paymentInfo}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━`;

    return this.sendToAdmin(message);
  }

  /**
   * Notify admin when an order status is updated.
   * @param {object} order - Mongoose Order document
   */
  async notifyOrderStatusUpdate(order) {
    const statusEmoji = {
      'Processing':       '⚙️',
      'Shipped':          '🚚',
      'Out for Delivery': '🏍️',
      'Delivered':        '✅',
      'Cancelled':        '❌',
      'RTO':              '🔄',
    }[order.orderStatus] || '📦';

    const awbLine = order.awbNumber
      ? `\n📬 AWB: ${order.awbNumber}${order.courierName ? ` (${order.courierName})` : ''}`
      : '';

    const message =
      `${statusEmoji} *ORDER STATUS UPDATED*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 Order ID: ${order.orderId}\n` +
      `🔄 New Status: *${order.orderStatus}*${awbLine}\n` +
      `⏰ Updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━`;

    return this.sendToAdmin(message);
  }
}

module.exports = new WhatsAppService();
