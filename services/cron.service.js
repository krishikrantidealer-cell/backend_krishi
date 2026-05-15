const Order = require('../models/Order');
const Cart = require('../models/Cart');
const orderService = require('./order.service');
const notificationService = require('./notification.service');

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
        orderStatus: { $in: ['Pending', 'Processing', 'Shipped', 'Out for Delivery'] }
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
      });

      if (abandonedCarts.length === 0) {
        console.log('[Cron] No abandoned carts to notify.');
        return;
      }

      console.log(`[Cron] Found ${abandonedCarts.length} abandoned carts. Sending reminders...`);
      for (let cart of abandonedCarts) {
        try {
          await notificationService.sendMarketingNotification(
            cart.user,
            "You left something behind! 🛒",
            "Your items are waiting for you. Complete your checkout before stock runs out!",
            "/cart"
          );
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

  // Execute immediately on startup
  runOrderSync();
  runAbandonedCartCheck();

  // Set intervals
  setInterval(runOrderSync, 20 * 60 * 1000);
  setInterval(runAbandonedCartCheck, 60 * 60 * 1000);
};
