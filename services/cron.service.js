const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CheckoutSession = require('../models/CheckoutSession');
const User = require('../models/User');
const orderService = require('./order.service');
const notificationService = require('./notification.service');
const whatsappService = require('./whatsapp.service');
const pushNotificationSegmentService = require('./pushNotificationSegment.service');
const whatsappAutomationService = require('./whatsappAutomation.service');

// Persistent track of daily runs to prevent misses due to server reboots or interval drift
const lastRunDates = {
  job9AM: null,
  job1130AM: null,
  job2PM: null,
  job530PM: null,
  job8PM: null
};

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

  // 5. Scheduled Segment Notifications (Every 30 mins)
  const runScheduledSegmentNotifications = async () => {
    try {
      // Get current time in IST safely using Intl.DateTimeFormat (robust across all Node versions & OS locales)
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
      });
      const parts = formatter.formatToParts(new Date());
      const hours = parseInt(parts.find(p => p.type === 'hour').value, 10);
      const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);

      // We'll track the date string in IST
      const datePart = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric'
      }).format(new Date());

      console.log(`[Cron] Checking Scheduled Notifications (IST Time: ${hours}:${minutes}, Date: ${datePart})`);

      // 9:00 AM - KYC reminders (Runs once a day, anytime at or after 9:00 AM)
      if (hours >= 9 && lastRunDates.job9AM !== datePart) {
        console.log(`[Cron] Triggering 9:00 AM KYC Reminder Job for date ${datePart}`);
        lastRunDates.job9AM = datePart;
        await pushNotificationSegmentService.trigger9AMJobs();
      }

      // 11:30 AM - First order reminders (Runs once a day, anytime at or after 11:30 AM)
      if ((hours > 11 || (hours === 11 && minutes >= 30)) && lastRunDates.job1130AM !== datePart) {
        console.log(`[Cron] Triggering 11:30 AM First Order Job for date ${datePart}`);
        lastRunDates.job1130AM = datePart;
        await pushNotificationSegmentService.trigger1130AMJobs();
      }

      // 2:00 PM - Cart & checkout recovery (Runs once a day, anytime at or after 2:00 PM)
      if (hours >= 14 && lastRunDates.job2PM !== datePart) {
        console.log(`[Cron] Triggering 2:00 PM Cart & Checkout Recovery Job for date ${datePart}`);
        lastRunDates.job2PM = datePart;
        await pushNotificationSegmentService.trigger2PMJobs();
      }

      // 5:30 PM - New arrivals & offers (Runs once a day, anytime at or after 5:30 PM)
      if ((hours > 17 || (hours === 17 && minutes >= 30)) && lastRunDates.job530PM !== datePart) {
        console.log(`[Cron] Triggering 5:30 PM New Arrivals Job for date ${datePart}`);
        lastRunDates.job530PM = datePart;
        await pushNotificationSegmentService.trigger530PMJobs();
      }

      // 8:00 PM - Urgency notifications (Runs once a day, anytime at or after 8:00 PM)
      if (hours >= 20 && lastRunDates.job8PM !== datePart) {
        console.log(`[Cron] Triggering 8:00 PM Urgency Job for date ${datePart}`);
        lastRunDates.job8PM = datePart;
        await pushNotificationSegmentService.trigger8PMJobs();
      }

    } catch (error) {
      console.error('[Cron] Error in Scheduled Segment Notifications cron job:', error);
    }
  };

  // 6. WhatsApp Automation Task (Every hour)
  const runWhatsAppAutomation = async () => {
    try {
      console.log('[Cron] Running WhatsApp Automation...');
      await whatsappAutomationService.sendWelcomeMessage();
      await whatsappAutomationService.sendKycReminders();
      await whatsappAutomationService.sendCartReminders();
      await whatsappAutomationService.sendCheckoutReminders();
      await whatsappAutomationService.sendWinBackMessages();
      console.log('[Cron] WhatsApp Automation completed.');
    } catch (error) {
      console.error('[Cron] Error in WhatsApp Automation cron job:', error);
    }
  };

  // Execute immediately on startup
  runOrderSync();
  runAbandonedCartCheck();
  runAbandonedCheckoutCheck();
  runKycUrgencyCheck();
  runScheduledSegmentNotifications();
  runWhatsAppAutomation();

  // Set intervals
  setInterval(runOrderSync, 20 * 60 * 1000);
  setInterval(runAbandonedCartCheck, 60 * 60 * 1000);
  setInterval(runAbandonedCheckoutCheck, 30 * 60 * 1000);
  setInterval(runKycUrgencyCheck, 30 * 60 * 1000);
  setInterval(runScheduledSegmentNotifications, 30 * 60 * 1000);
  setInterval(runWhatsAppAutomation, 60 * 60 * 1000);
};
