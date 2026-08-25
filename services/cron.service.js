const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CheckoutSession = require('../models/CheckoutSession');
const User = require('../models/User');
const NotificationCampaign = require('../models/NotificationCampaign');
const orderService = require('./order.service');
const notificationService = require('./notification.service');
const whatsappService = require('./whatsapp.service');
const pushNotificationSegmentService = require('./pushNotificationSegment.service');
const whatsappAutomationService = require('./whatsappAutomation.service');
const { redisClient } = require('../config/redis');

// Persistent in-memory map of daily runs for fallback
const lastRunDates = {};

// Redis helpers to read/write last run dates to survive container scaling & server restarts
const getLastRunDate = async (jobKey) => {
  try {
    if (redisClient && redisClient.isOpen) {
      return await redisClient.get(`cron:lastrun:${jobKey}`);
    }
    return lastRunDates[jobKey] || null;
  } catch (err) {
    return lastRunDates[jobKey] || null;
  }
};

const setLastRunDate = async (jobKey, datePart) => {
  lastRunDates[jobKey] = datePart;
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.set(`cron:lastrun:${jobKey}`, datePart, { EX: 86400 });
    }
  } catch (err) {
    console.error(`[Redis Cron] Failed to set last run for ${jobKey}:`, err.message);
  }
};

/**
 * Background Service Tasks (Exposed for manual triggering via Cron Routes)
 */

// 1. Order Sync Task (Every 20 mins)
const runOrderSync = async () => {
  try {
    console.log('[Cron] Starting Automated Order Status Sync...');
    const activeOrders = await Order.find({
      awbNumber: { $exists: true, $ne: '' },
      orderStatus: { $in: ['Processing', 'Shipped', 'Out for Delivery'] }
    });

    if (activeOrders.length === 0) {
      console.log('[Cron] No active orders with AWB tracking to sync.');
      return;
    }

    console.log(`[Cron] Syncing ${activeOrders.length} orders...`);
    for (let order of activeOrders) {
      try {
        await orderService.syncDelhiveryTracking(order._id, order.user);
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
        { reminderCount: { $exists: false } },
        { reminderCount: { $lt: 2 } }
      ],
      $and: [
        {
          $or: [
            { lastReminderSentAt: { $exists: false } },
            { lastReminderSentAt: null },
            { lastReminderSentAt: { $lt: twentyFourHoursAgo } }
          ]
        }
      ]
    }).populate('user');

    if (abandonedCarts.length === 0) {
      console.log('[Cron] No abandoned carts to notify.');
      return;
    }

    console.log(`[Cron] Found ${abandonedCarts.length} abandoned carts. Sending reminders...`);
    for (let cart of abandonedCarts) {
      try {
        if (!cart.user || !cart.user.fcmToken) continue;

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
        cart.reminderCount = (cart.reminderCount || 0) + 1;
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
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const abandonedSessions = await CheckoutSession.find({
      status: 'Pending',
      orderCreated: { $ne: true },
      createdAt: { $lt: thirtyMinsAgo, $gt: fortyEightHoursAgo },
      $or: [
        { reminderCount: { $exists: false } },
        { reminderCount: { $lt: 2 } }
      ]
    }).populate('user');

    if (abandonedSessions.length === 0) {
      console.log('[Cron] No abandoned checkouts to notify.');
      return;
    }

    console.log(`[Cron] Found ${abandonedSessions.length} abandoned checkouts. Verifying payment status & sending reminders...`);
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const axios = require('axios');

    for (let session of abandonedSessions) {
      try {
        // 0. Auto-Reconciliation: Check if this session was actually paid on Razorpay (Safety Net 3)
        if (keyId && keySecret && !keySecret.includes('YOUR_') && session.razorpayOrderId && !session.razorpayOrderId.startsWith('mock_')) {
          try {
            const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
            const rzpRes = await axios.get(`https://api.razorpay.com/v1/orders/${session.razorpayOrderId}/payments`, {
              headers: { 'Authorization': `Basic ${auth}` },
              timeout: 5000
            });
            const payments = rzpRes.data?.items || [];
            const successfulPayment = payments.find(p => p.status === 'captured' || p.status === 'authorized');
            if (successfulPayment) {
              console.log(`[Cron] Auto-recovering paid order for session ${session.razorpayOrderId} with payment ${successfulPayment.id}`);
              const orderService = require('./order.service');
              await orderService.confirmOrder(session, { razorpayPaymentId: successfulPayment.id });
              continue; // Successfully recovered order! Do not send abandoned checkout reminder.
            }
          } catch (rzpCheckErr) {
            console.warn(`[Cron] Razorpay payment check skipped for ${session.razorpayOrderId}:`, rzpCheckErr.message);
          }
        }

        if (!session.user || !session.user.fcmToken) continue;

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
        session.reminderCount = (session.reminderCount || 0) + 1;
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

    const usersToRemind = await User.find({
      phoneNumber: { $exists: true, $ne: null, $ne: "" },
      fcmToken: { $exists: true, $nin: [null, ''] },
      kycStatus: 'pending',
      createdAt: { $lt: thirtyMinsAgo },
      $or: [
        { kycReminderCount: { $exists: false } },
        { kycReminderCount: { $lt: 5 } }
      ],
      $and: [
        {
          $or: [
            { lastKycReminderSentAt: { $exists: false } },
            { lastKycReminderSentAt: null },
            { lastKycReminderSentAt: { $lt: oneDayAgo } }
          ]
        }
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
          "/kyc"
        );

        user.lastKycReminderSentAt = new Date();
        user.kycReminderCount = (user.kycReminderCount || 0) + 1;
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

// 5. 100% Dynamic Scheduled Segment Notifications (Evaluates dynamic DB schedules every 10-15 mins)
const runScheduledSegmentNotifications = async (forcedJob = null) => {
  try {
    await pushNotificationSegmentService.ensureSeedCampaigns();

    // Kolkata is UTC + 5:30. Calculate local Kolkata date/time mathematically
    const date = new Date();
    const kolkataMillis = date.getTime() + (5.5 * 60 * 60 * 1000);
    const kolkataDate = new Date(kolkataMillis);

    const hours = kolkataDate.getUTCHours();
    const minutes = kolkataDate.getUTCMinutes();
    const currentMinutesOfDay = hours * 60 + minutes;
    const datePart = `${kolkataDate.getUTCFullYear()}-${String(kolkataDate.getUTCMonth() + 1).padStart(2, '0')}-${String(kolkataDate.getUTCDate()).padStart(2, '0')}`;

    console.log(`[Cron] Dynamic Campaign Checker (Kolkata: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}, Date: ${datePart}, forcedJob: ${forcedJob || 'auto'})`);

    const campaigns = await NotificationCampaign.find({}).lean();

    for (const camp of campaigns) {
      const segKey = camp.segmentKey;
      const isForced = forcedJob === segKey || forcedJob === 'ALL';

      if (!isForced && !camp.isEnabled) {
        continue;
      }

      // Parse scheduled time "HH:mm"
      const [schedHourStr, schedMinStr] = (camp.scheduledTime || "09:00").split(":");
      const schedHour = parseInt(schedHourStr, 10) || 0;
      const schedMin = parseInt(schedMinStr, 10) || 0;
      const schedMinutesOfDay = schedHour * 60 + schedMin;

      // Allow a 90-minute trigger window around the scheduled time so 15m polling never misses it
      const isInTimeWindow = currentMinutesOfDay >= schedMinutesOfDay && currentMinutesOfDay < (schedMinutesOfDay + 90);

      if (isForced || isInTimeWindow) {
        const jobKey = `dynamic_seg_${segKey}`;
        const lastRun = await getLastRunDate(jobKey);

        if (isForced || lastRun !== datePart) {
          console.log(`[Cron] Triggering dynamic campaign for Segment ${segKey} at scheduled time ${camp.scheduledTime} (IST Date: ${datePart})`);
          await setLastRunDate(jobKey, datePart);
          await pushNotificationSegmentService.sendToSegment(segKey);
        }
      }
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

/**
 * Initialize Fallback Interval-Based Cron Jobs (for local development/persistent server)
 */
exports.initCronJobs = () => {
  console.log('--- Background Services Initialized (Orders, Carts & 100% Dynamic Push Campaigns) ---');

  // Execute on startup
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
  setInterval(() => runScheduledSegmentNotifications(), 10 * 60 * 1000);
  setInterval(runWhatsAppAutomation, 60 * 60 * 1000);
};

// Export individual tasks for router triggering
module.exports = {
  initCronJobs: exports.initCronJobs,
  runOrderSync,
  runAbandonedCartCheck,
  runAbandonedCheckoutCheck,
  runKycUrgencyCheck,
  runScheduledSegmentNotifications,
  runWhatsAppAutomation
};
