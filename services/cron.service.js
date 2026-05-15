const Order = require('../models/Order');
const Cart = require('../models/Cart');
const orderService = require('./order.service');
const notificationService = require('./notification.service');

/**
 * Background service to handle automated tasks without webhooks
 */
exports.initCronJobs = () => {
  console.log('--- Background Order Tracker Initialized (Runs every 20 mins) ---');
  
  // Run every 20 minutes
  // 20 * 60 * 1000 = 1,200,000 ms
  setInterval(async () => {
    try {
      console.log('[Cron] Starting Automated Order Status Sync...');
      
      // 1. Find all active orders that need tracking
      const activeOrders = await Order.find({
        orderStatus: { $in: ['Pending', 'Processing', 'Shipped', 'Out for Delivery'] }
      });

      if (activeOrders.length === 0) {
        console.log('[Cron] No active orders to sync.');
        return;
      }

      console.log(`[Cron] Syncing ${activeOrders.length} orders...`);

      // 2. Sync each order
      // We use for...of to avoid hitting API rate limits too hard by running sequentially
      for (let order of activeOrders) {
        try {
          // This method already handles DB updates and Push Notifications
          await orderService.syncDelhiveryTracking(order.user, order._id);
        } catch (err) {
          console.error(`[Cron] Failed to sync order ${order.orderId}:`, err.message);
        }
      }

      console.log('[Cron] Automated Sync Completed.');
    } catch (error) {
      console.error('[Cron] Critical error in background job:', error);
    }
  }, 20 * 60 * 1000);

  // Abandoned Cart Checker
  // Runs every hour
  setInterval(async () => {
    try {
      console.log('[Cron] Checking for Abandoned Carts...');

      // 1. Find all carts with items that haven't been updated in 2 hours
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const abandonedCarts = await Cart.find({
        items: { $exists: true, $not: { $size: 0 } },
        updatedAt: { $lt: twoHoursAgo, $gt: twentyFourHoursAgo }, // Between 2 and 24 hours ago
        $or: [
          { lastReminderSentAt: { $exists: false } },
          { lastReminderSentAt: { $lt: twentyFourHoursAgo } } // Only remind once every 24h
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

          // Mark as reminded
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
  }, 60 * 60 * 1000); // 1 hour interval
};
