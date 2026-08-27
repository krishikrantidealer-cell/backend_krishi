const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CheckoutSession = require('../models/CheckoutSession');
const whatsappService = require('./whatsapp.service');

class WhatsAppAutomationService {

  /**
   * Helper: Determine Meta template language code
   * Default to 'en_US', or 'hi' if user selected Hindi
   */
  getUserLanguage(user) {
    if (!user) return 'hi';
    const lang = (user.preferredLanguage || '').toLowerCase();
    if (lang === 'hi' || lang === 'hindi') return 'hi';
    if (lang === 'mr') return 'mr';
    if (lang === 'te') return 'te';
    if (lang === 'ta') return 'ta';
    if (lang === 'kn') return 'kn';
    return 'hi';
  }

  /**
   * 1. Welcome Message (15 min after install)
   * Template: kd_welcome (Vars: {{1}} = Name)
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
      const lang = this.getUserLanguage(user);
      const sent = await whatsappService.sendTemplateMessage(
        user.phoneNumber,
        'kd_welcome',
        lang,
        [user.firstName || 'Dealer']
      );
      if (sent) {
        user.lastWhatsappType = 'WELCOME';
        user.lastWhatsappSentAt = new Date();
        await user.save();
      }
    }
  }

  /**
   * 2. Abandoned Cart Reminders
   * Template: kd_cart_abandoned (Vars: {{1}} = Name)
   */
  async sendCartReminders() {
    const now = new Date();
    const intervals = [
      { mins: 30, type: 'CART_30M' },
      { mins: 1440, type: 'CART_24H' },
      { mins: 4320, type: 'CART_72H' }
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
          const lang = this.getUserLanguage(cart.user);
          const sent = await whatsappService.sendTemplateMessage(
            cart.user.phoneNumber,
            'kd_cart_abandoned',
            lang,
            [cart.user.firstName || 'Dealer']
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
   * 3. Abandoned Checkout Reminders (30m, 24h, 72h)
   * Templates: kd_checkout_reminder_1, kd_checkout_reminder_2, kd_checkout_reminder_3
   */
  async sendCheckoutReminders() {
    const now = new Date();
    const intervals = [
      { mins: 30, type: 'CHECKOUT_30M', template: 'kd_checkout_reminder_1' },
      { mins: 1440, type: 'CHECKOUT_24H', template: 'kd_checkout_reminder_2' },
      { mins: 4320, type: 'CHECKOUT_72H', template: 'kd_checkout_reminder_3' }
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
          const lang = this.getUserLanguage(session.user);
          const sent = await whatsappService.sendTemplateMessage(
            session.user.phoneNumber,
            interval.template,
            lang,
            [session.user.firstName || 'Dealer']
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
   * 4. KYC Reminders (Day 1, 3, 7)
   * Template: kd_kyc_reminder (Vars: {{1}} = Name)
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
        const lang = this.getUserLanguage(user);
        const sent = await whatsappService.sendTemplateMessage(
          user.phoneNumber,
          'kd_kyc_reminder',
          lang,
          [user.firstName || 'Dealer']
        );
        if (sent) {
          user.lastWhatsappType = interval.type;
          user.lastWhatsappSentAt = now;
          await user.save();
        }
      }
    }
  }

  /**
   * 5. Win-Back sequences (30, 60, 90 days)
   * Template: kd_win_back (Vars: {{1}} = Name)
   */
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
        const lang = this.getUserLanguage(user);
        const sent = await whatsappService.sendTemplateMessage(
          user.phoneNumber,
          'kd_win_back',
          lang,
          [user.firstName || 'Dealer']
        );
        if (sent) {
          user.lastWhatsappType = `WINBACK_${days}`;
          user.lastWhatsappSentAt = now;
          await user.save();
        }
      }
    }
  }

  // ─── IMMEDIATE EVENT TRIGGERS ──────────────────────────────────────────

  /**
   * KYC Approved
   * Template: kd_kyc_approved (Vars: {{1}} = Name)
   */
  async notifyKycApproved(user) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_kyc_approved',
      lang,
      [user.firstName || 'Dealer']
    );
  }

  /**
   * Incomplete KYC / Rejected Docs
   * Template: kd_incomplete_kyc (Vars: {{1}} = Name, {{2}} = Missing Documents)
   */
  async notifyIncompleteKyc(user, missingDocs = 'Shop Photo / License') {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_incomplete_kyc',
      lang,
      [user.firstName || 'Dealer', missingDocs]
    );
  }

  /**
   * First Order Reminder
   * Template: kd_first_order_reminder (Vars: {{1}} = Name)
   */
  async notifyFirstOrderReminder(user) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_first_order_reminder',
      lang,
      [user.firstName || 'Dealer']
    );
  }

  /**
   * Order Confirmation
   * Template: kd_order_confirmed (Vars: {{1}} = Name, {{2}} = Order ID, {{3}} = Amount)
   */
  async notifyOrderConfirmation(user, order) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    const orderId = order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER');
    const amount = String(order.totalAmount || order.payableAmount || 0);

    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_order_confirmed',
      lang,
      [user.firstName || 'Dealer', orderId, amount]
    );
  }

  /**
   * Order Shipped
   * Template: kd_order_shipped (Vars: {{1}} = Name, {{2}} = Order ID, {{3}} = Tracking info)
   */
  async notifyOrderShipped(user, order) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    const orderId = order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER');
    const courier = (order.courierName && order.awbNumber)
      ? `${order.courierName} (AWB: ${order.awbNumber})`
      : (order.trackingDetails?.courierName
          ? `${order.trackingDetails.courierName} (AWB: ${order.trackingDetails.trackingNumber || ""})`
          : (order.trackingUrl || "in Krishi Kranti App"));

    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_order_shipped',
      lang,
      [user.firstName || 'Dealer', orderId, courier]
    );
  }

  /**
   * Order Delivered
   * Template: kd_order_delivered (Vars: {{1}} = Name, {{2}} = Order ID)
   */
  async notifyOrderDelivered(user, order) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    const orderId = order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER');

    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_order_delivered',
      lang,
      [user.firstName || 'Dealer', orderId]
    );
  }

  /**
   * Advance / Pending Payment
   * Template: kd_payment_pending (Vars: {{1}} = Name, {{2}} = Order ID, {{3}} = Amount)
   */
  async notifyPaymentPending(user, order) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    const orderId = order.orderId || (order._id ? order._id.toString().slice(-6).toUpperCase() : 'KD-ORDER');
    const amount = String(order.pendingAmount || order.advancePaymentAmount || order.totalAmount || 0);

    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_payment_pending',
      lang,
      [user.firstName || 'Dealer', orderId, amount]
    );
  }

  /**
   * Repeat Purchase Reminder
   * Template: kd_repeat_purchase (Vars: {{1}} = Name)
   */
  async notifyRepeatPurchase(user) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_repeat_purchase',
      lang,
      [user.firstName || 'Dealer']
    );
  }

  /**
   * New Products Launch
   * Template: kd_new_products (Vars: {{1}} = Name, {{2}} = Category/Product info)
   */
  async notifyNewProducts(user, productText = 'Bio-Fertilizers & Hybrid Seeds') {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_new_products',
      lang,
      [user.firstName || 'Dealer', productText]
    );
  }

  /**
   * Seasonal Campaign
   * Template: kd_seasonal_campaign (Vars: {{1}} = Name, {{2}} = Season name)
   */
  async notifySeasonalCampaign(user, seasonName = 'Kharif') {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_seasonal_campaign',
      lang,
      [user.firstName || 'Dealer', seasonName]
    );
  }

  /**
   * High Value VIP Offer
   * Template: kd_high_value_offer (Vars: {{1}} = Name)
   */
  async notifyHighValueOffer(user) {
    if (!user || !user.phoneNumber) return;
    const lang = this.getUserLanguage(user);
    return whatsappService.sendTemplateMessage(
      user.phoneNumber,
      'kd_high_value_offer',
      lang,
      [user.firstName || 'Dealer']
    );
  }
}

module.exports = new WhatsAppAutomationService();
