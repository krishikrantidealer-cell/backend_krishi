const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CheckoutSession = require('../models/CheckoutSession');
const User = require('../models/User');
const orderService = require('./order.service');
const notificationService = require('./notification.service');
const whatsappService = require('./whatsapp.service');

/**
 * Background service to handle automated tasks without webhooks
 */
exports.initCronJobs = () => {
  console.log('--- Background Services Initialized (Orders & Carts) ---');

  // 1. Order Sync Task (Every 20 mins)
  const runOrderSync = async () => {
    try {
      console.log('[Cron] Starting Automated Order Status Sync...');
      const activeOrders = await Order.find({
        orderStatus: { $in: ['Processing', 'Shipped', 'Out for Delivery'] }
      });

      if (activeOrders.length === 0) {
        console.log('[Cron] No active orders to sync.');
        return;
      }

      console.log(`[Cron] Syncing ${activeOrders.length} orders...`);
      for (let order of activeOrders) {
        try {
          await orderService.syncDelhiveryTracking(order.user, order._id);
        } catch (err) {
          console.error(`[Cron] Failed to sync order ${order._id}:`, err.message);
        }
      }
      console.log('[Cron] Automated Sync Completed.');
    } catch (error) {
      console.error('[Cron] Critical error in order sync job:', error);
    }
  };

  // 2. Abandoned Cart Checker (Every hour)
  const runAbandonedCartCheck = async () => {
    try {
      console.log('[Cron] Checking for Abandoned Carts...');
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const abandonedCarts = await Cart.find({
        items: { $exists: true, $not: { $size: 0 } },
        updatedAt: { $lt: twoHoursAgo, $gt: twentyFourHoursAgo },
        $or: [
          { lastReminderSentAt: { $exists: false } },
          { lastReminderSentAt: { $lt: twentyFourHoursAgo } }
        ]
      }).populate('user');

      if (abandonedCarts.length === 0) {
        console.log('[Cron] No abandoned carts to notify.');
        return;
      }

      console.log(`[Cron] Found ${abandonedCarts.length} abandoned carts. Sending reminders...`);
      for (let cart of abandonedCarts) {
        try {
          if (!cart.user) continue;

          // 1. Push Notification
          await notificationService.sendMarketingNotification(
            cart.user._id,
            "You left something behind! 🛒",
            "Your items are waiting for you. Complete your checkout before stock runs out!",
            "/cart"
          );

          // 2. WhatsApp Notification
          await whatsappService.notifyAbandonedCart(cart.user);

          cart.lastReminderSentAt = new Date();
          await cart.save();
        } catch (err) {
          console.error(`[Cron] Failed to notify user for cart ${cart._id}:`, err.message);
        }
      }
      console.log('[Cron] Abandoned Cart reminders sent.');
    } catch (error) {
      console.error('[Cron] Error in Abandoned Cart cron job:', error);
    }
  };

  // 3. Abandoned Checkout Checker (Every 30 mins)
  const runAbandonedCheckoutCheck = async () => {
    try {
      console.log('[Cron] Checking for Abandoned Checkouts...');
      // Looking for sessions started between 30 mins and 2 hours ago that didn't result in an order
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const abandonedSessions = await CheckoutSession.find({
        status: 'Pending',
        orderCreated: { $ne: true },
        createdAt: { $lt: thirtyMinsAgo, $gt: twoHoursAgo },
        lastReminderSentAt: { $exists: false }
      }).populate('user');

      if (abandonedSessions.length === 0) {
        console.log('[Cron] No abandoned checkouts to notify.');
        return;
      }

      console.log(`[Cron] Found ${abandonedSessions.length} abandoned checkouts. Sending reminders...`);
      for (let session of abandonedSessions) {
        try {
          if (!session.user) continue;

          // 1. Push Notification
          await notificationService.sendMarketingNotification(
            session.user._id,
            "Checkout incomplete! ⚠️",
            "We noticed you didn't finish your order. Would you like to complete it now?",
            "/cart"
          );

          // 2. WhatsApp Notification
          await whatsappService.notifyAbandonedCheckout(session.user, session);

          session.lastReminderSentAt = new Date();
          await session.save();
        } catch (err) {
          console.error(`[Cron] Failed to notify user for session ${session._id}:`, err.message);
        }
      }
      console.log('[Cron] Abandoned Checkout reminders sent.');
    } catch (error) {
      console.error('[Cron] Error in Abandoned Checkout cron job:', error);
    }
  };

  // 4. KYC Urgency Checker (Every 30 mins)
  const runKycUrgencyCheck = async () => {
    try {
      console.log('[Cron] Checking for KYC Urgency...');
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Find users who logged in with a phone number, have pending KYC status,
      // registered at least 30 minutes ago, and either have never been reminded
      // or were reminded more than 24 hours ago.
      const usersToRemind = await User.find({
        phoneNumber: { $exists: true, $ne: null, $ne: "" },
        kycStatus: 'pending',
        createdAt: { $lt: thirtyMinsAgo },
        $or: [
          { lastKycReminderSentAt: { $exists: false } },
          { lastKycReminderSentAt: { $lt: oneDayAgo } }
        ]
      });

      if (usersToRemind.length === 0) {
        console.log('[Cron] No users to notify for KYC Urgency.');
        return;
      }

      console.log(`[Cron] Found ${usersToRemind.length} users for KYC Urgency reminder. Sending...`);
      for (let user of usersToRemind) {
        try {
          await notificationService.sendUtilityNotification(
            user._id,
            "⏳ अभी तक KYC पूरा नहीं किया?",
            "बस Shop Photo और License Upload करें और Wholesale Rates का फायदा उठाएँ।",
            "/profile"
          );

          user.lastKycReminderSentAt = new Date();
          await user.save();
        } catch (err) {
          console.error(`[Cron] Failed to send KYC reminder to user ${user._id}:`, err.message);
        }
      }
      console.log('[Cron] KYC Urgency reminders sent.');
    } catch (error) {
      console.error('[Cron] Error in KYC Urgency cron job:', error);
    }
  };

  // Execute immediately on startup
  runOrderSync();
  runAbandonedCartCheck();
  runAbandonedCheckoutCheck();
  runKycUrgencyCheck();

  // Set intervals
  setInterval(runOrderSync, 20 * 60 * 1000);
  setInterval(runAbandonedCartCheck, 60 * 60 * 1000);
  setInterval(runAbandonedCheckoutCheck, 30 * 60 * 1000);
  setInterval(runKycUrgencyCheck, 30 * 60 * 1000);
};
