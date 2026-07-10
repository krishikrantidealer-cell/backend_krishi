const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CheckoutSession = require('../models/CheckoutSession');
const whatsappService = require('./whatsapp.service');

class WhatsAppAutomationService {

  /**
   * 1. Welcome Message (15 min after install)
   */
  async sendWelcomeMessage() {
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    const newUsers = await User.find({
      createdAt: { $lte: fifteenMinsAgo, $gte: thirtyMinsAgo },
      lastWhatsappType: { $ne: 'WELCOME' },
      kycStatus: 'pending',
      phoneNumber: { $exists: true, $ne: null }
    });

    for (const user of newUsers) {
      const sent = await whatsappService.sendTemplateMessage(user.phoneNumber, 'welcome_krishi_dealer', 'hi', [user.firstName || 'Dealer']);
      if (sent) {
        user.lastWhatsappType = 'WELCOME';
        user.lastWhatsappSentAt = new Date();
        await user.save();
      }
    }
  }

  /**
   * 2. Abandoned Cart Reminders (Includes Cart Link)
   * Template: [Name, Cart Link]
   */
  async sendCartReminders() {
    const now = new Date();
    const intervals = [
      { mins: 30, type: 'CART_30M' },
      { mins: 1440, type: 'CART_24H' }
    ];

    for (const interval of intervals) {
      const targetTime = new Date(now.getTime() - interval.mins * 60 * 1000);
      const prevTime = new Date(targetTime.getTime() - 60 * 60 * 1000);

      const abandonedCarts = await Cart.find({
        updatedAt: { $lte: targetTime, $gte: prevTime },
        items: { $exists: true, $not: { $size: 0 } }
      }).populate('user');

      for (const cart of abandonedCarts) {
        if (cart.user && cart.user.phoneNumber && cart.user.lastWhatsappType !== interval.type) {
          // Template requires: {{1}} = Name, {{2}} = Link
          const sent = await whatsappService.sendTemplateMessage(
            cart.user.phoneNumber,
            'cart_abandoned_hindi',
            'hi',
            [cart.user.firstName || 'Dealer', 'https://krishikranti.com/cart']
          );
          if (sent) {
            cart.user.lastWhatsappType = interval.type;
            cart.user.lastWhatsappSentAt = now;
            await cart.user.save();
          }
        }
      }
    }
  }

  /**
   * 3. Abandoned Checkout Reminders (Includes Checkout Link)
   * Template: [Name, Checkout Link]
   */
  async sendCheckoutReminders() {
    const now = new Date();
    // Intervals for checkout specifically
    const intervals = [
      { mins: 45, type: 'CHECKOUT_45M' },
      { mins: 2880, type: 'CHECKOUT_48H' }
    ];

    for (const interval of intervals) {
      const targetTime = new Date(now.getTime() - interval.mins * 60 * 1000);
      const prevTime = new Date(targetTime.getTime() - 60 * 60 * 1000);

      const sessions = await CheckoutSession.find({
        status: 'Pending',
        orderCreated: { $ne: true },
        updatedAt: { $lte: targetTime, $gte: prevTime }
      }).populate('user');

      for (const session of sessions) {
        if (session.user && session.user.phoneNumber && session.user.lastWhatsappType !== interval.type) {
          // Template requires: {{1}} = Name, {{2}} = Link
          const sent = await whatsappService.sendTemplateMessage(
            session.user.phoneNumber,
            'checkout_incomplete_hindi',
            'hi',
            [session.user.firstName || 'Dealer', 'https://krishikranti.com/checkout']
          );
          if (sent) {
            session.user.lastWhatsappType = interval.type;
            session.user.lastWhatsappSentAt = now;
            await session.user.save();
          }
        }
      }
    }
  }

  /**
   * 4. KYC & Win-Back sequences
   */
  async sendKycReminders() {
    const now = new Date();
    const intervals = [{ day: 1, type: 'KYC_1' }, { day: 3, type: 'KYC_3' }, { day: 7, type: 'KYC_7' }];

    for (const interval of intervals) {
      const targetDate = new Date(now.getTime() - interval.day * 24 * 60 * 60 * 1000);
      const nextTargetDate = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);

      const users = await User.find({
        createdAt: { $lte: targetDate, $gte: nextTargetDate },
        kycStatus: 'pending',
        isKycComplete: false,
        shopImage: { $exists: false },
        lastWhatsappType: { $ne: interval.type },
        phoneNumber: { $exists: true, $ne: null }
      });

      for (const user of users) {
        const sent = await whatsappService.sendTemplateMessage(user.phoneNumber, 'kyc_reminder_krishi', 'hi', [user.firstName || 'Dealer']);
        if (sent) {
          user.lastWhatsappType = interval.type;
          user.lastWhatsappSentAt = now;
          await user.save();
        }
      }
    }
  }

  async sendWinBackMessages() {
    const intervals = [30, 60, 90];
    const now = new Date();
    for (const days of intervals) {
      const targetDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const nextTargetDate = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);

      const users = await User.find({
        updatedAt: { $lte: targetDate, $gte: nextTargetDate },
        lastWhatsappType: { $ne: `WINBACK_${days}` },
        phoneNumber: { $exists: true, $ne: null }
      });

      for (const user of users) {
        const sent = await whatsappService.sendTemplateMessage(user.phoneNumber, 'win_back_krishi', 'hi', [user.firstName || 'Dealer']);
        if (sent) {
          user.lastWhatsappType = `WINBACK_${days}`;
          user.lastWhatsappSentAt = now;
          await user.save();
        }
      }
    }
  }

  // Immediate event triggers
  async notifyKycApproved(user) { if (user.phoneNumber) return whatsappService.sendTemplateMessage(user.phoneNumber, 'kyc_approved_krishi', 'hi', [user.firstName || 'Dealer']); }
  async notifyOrderConfirmation(user, order) { if (user.phoneNumber) return whatsappService.sendTemplateMessage(user.phoneNumber, 'order_confirmed_krishi', 'hi', [user.firstName || 'Dealer', order.orderId]); }
  async notifyOrderShipped(user, order) { if (user.phoneNumber) return whatsappService.sendTemplateMessage(user.phoneNumber, 'order_shipped_krishi', 'hi', [user.firstName || 'Dealer', order.orderId, order.trackingUrl || 'in the app']); }
  async notifyOrderDelivered(user, order) { if (user.phoneNumber) return whatsappService.sendTemplateMessage(user.phoneNumber, 'order_delivered_krishi', 'hi', [user.firstName || 'Dealer', order.orderId]); }
}

module.exports = new WhatsAppAutomationService();
