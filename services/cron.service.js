const Order = require('../models/Order');
const orderService = require('./order.service');

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
};
