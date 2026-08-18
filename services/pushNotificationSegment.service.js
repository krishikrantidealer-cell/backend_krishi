const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CheckoutSession = require('../models/CheckoutSession');
const notificationService = require('./notification.service');

const SEGMENT_NOTIFICATIONS = {
  // Segment A: Installed → KYC Not Started (Goal: Complete KYC | Frequency: Daily 3–5 days)
  A: [
    { title: "🔓 Dealer Price Unlock करें!", body: "बस Shop Photo और License Upload करें। KYC पूरा होते ही Wholesale Rates दिखाई देंगे।" },
    { title: "🏪 आपकी दुकान तैयार है?", body: "अब सिर्फ KYC Complete करें और Bulk Purchase शुरू करें।" },
    { title: "💰 Retail नहीं... Dealer Price पर खरीदें!", body: "KYC पूरा करें और ज्यादा Margin कमाएँ।" },
    { title: "⚡ 2 मिनट का काम...", body: "Shop Photo Upload करें, Wholesale Price Unlock करें।" },
    { title: "📦 Bulk खरीदारी अब आसान है!", body: "KYC Complete करें और हजारों Products Dealer Rate पर खरीदें." }
  ],

  // Segment B: KYC Started → Docs Pending (Goal: Complete KYC | Frequency: Daily)
  B: [
    { title: "📄 आपका KYC अधूरा है।", body: "बस बाकी Documents Upload करें और Approval प्राप्त करें।" },
    { title: "⏳ आपका Approval आपका इंतजार कर रहा है।", body: "Remaining Documents Upload करें।" },
    { title: "🚀 Wholesale Buying से बस एक कदम दूर।", body: "KYC Complete करें और Dealer Prices देखें." }
  ],

  // Segment C: KYC Under Review (Goal: Reduce anxiety | Frequency: Once/day)
  C: [
    { title: "✅ आपका KYC Review में है।", body: "Approval मिलते ही Notification भेज दी जाएगी।" },
    { title: "🔍 आपका Verification चल रहा है।", body: "थोड़ा इंतजार करें। जल्द ही Dealer Prices Unlock हो जाएंगी।" }
  ],

  // Segment D: KYC Approved → No Order (Goal: First Purchase | Frequency: Daily)
  D: [
    { title: "🎉 आपका KYC Approved हो गया!", body: "अब Dealer Price पर अपना पहला Order Place करें।" },
    { title: "📦 Stock भरने का सही समय!", body: "Wholesale Price Unlock हो चुकी है। आज ही पहला Order करें।" },
    { title: "💸 ज्यादा Margin कमाने का मौका!", body: "Bulk खरीदें और ज्यादा Profit कमाएँ।" },
    { title: "🚚 Fast Delivery + Wholesale Rates.", body: "अब पहला Order Place करें।" },
    { title: "🎯 Dealer बनने का अगला कदम...", body: "पहला Order करें और Business बढ़ाएँ।" }
  ],

  // Segment E: Cart Abandoned (Goal: Recover Cart | Frequency: 2 reminders)
  E: [
    { title: "🛒 आपका Cart आपका इंतजार कर रहा है।", body: "Order Complete करें और Fast Delivery पाएँ।" },
    { title: "⏰ Cart में Products अभी भी मौजूद हैं।", body: "Checkout पूरा करें।" },
    { title: "🚚 जल्दी करें!", body: "आपका Bulk Order अभी भी Pending है." }
  ],

  // Segment F: Checkout / Payment Pending (Goal: Complete Payment | Frequency: 2 reminders)
  F: [
    { title: "💳 आपका Payment Pending है।", body: "Order Complete करें और Dispatch शुरू करवाएँ।" },
    { title: "📦 आपका Order तैयार है।", body: "बस Payment Complete करें।" },
    { title: "🚀 जल्दी करें!", body: "Payment Complete होते ही Order Dispatch होगा।" }
  ],

  // Segment G: Ordered Once (Goal: Repeat Purchase | Frequency: 7–15 days)
  G: [
    { title: "📈 Stock खत्म होने का इंतजार क्यों?", body: "आज ही Bulk Order करें।" },
    { title: "🚚 Fast Delivery के साथ फिर से Order करें।", body: "Wholesale Rates आपका इंतजार कर रही हैं।" },
    { title: "🌾 अपने Business की Supply बनाए रखें।", body: "Bulk Order करें।" },
    { title: "💰 ज्यादा खरीदें... ज्यादा बचत करें।", body: "Wholesale Rates पर फिर से Order करें और ज्यादा Profit कमाएँ।" }
  ],

  // Segment H: Active Buyers / New Products (Goal: Cross-sell | Frequency: 2–3/week)
  H: [
    { title: "🆕 नए Products आ चुके हैं!", body: "नई Range देखें और सबसे पहले Order करें।" },
    { title: "🌱 आपके लिए नए Agro Products Available हैं।", body: "App खोलें और देखें।" },
    { title: "🔥 Best Selling Products की नई Range Available।", body: "अभी देखें और Bulk Order करें।" }
  ],

  // Segment I: High Value Dealers (Goal: VIP Offers | Frequency: Weekly)
  I: [
    { title: "🎁 ₹50,000+ Order पर Special Surprise!", body: "Bulk खरीदारी करें और पाएँ FREE 10L Product.*" },
    { title: "🏆 बड़े Dealers के लिए Exclusive Benefit!", body: "₹50,000+ खरीदें और Surprise Gift पाएँ।" },
    { title: "🚛 बड़ा Stock... बड़ा फायदा...", body: "₹50,000+ Order करें और Exclusive Discounts पाएँ।" }
  ],

  // Segment J: Inactive 30+ Days (Goal: Win-back | Frequency: Weekly)
  J: [
    { title: "👋 काफी समय हो गया...", body: "फिर से Wholesale Price पर खरीदारी शुरू करें।" },
    { title: "📦 आपका Dealer Account अभी भी Active है।", body: "आज ही Bulk Order करें।" },
    { title: "💰 Business को दोबारा Growth दें।", body: "Wholesale Rates आपका इंतजार कर रही हैं।" }
  ],

  // Seasonal Notifications
  SEASONAL: [
    { title: "🌧️ खरीफ Season शुरू!", body: "आज ही Bulk Stock करें और Demand बढ़ने से पहले तैयारी करें।" },
    { title: "🌾 सीजन की तैयारी अभी से करें।", body: "Wholesale Rate पर Bulk खरीदारी का सही समय।" },
    { title: "🚜 किसानों की Demand बढ़ रही है।", body: "Stock पहले भरें, Profit ज्यादा कमाएँ।" }
  ],

  // Urgency Notifications
  URGENCY: [
    { title: "⚡ आज Order, जल्दी Dispatch!", body: "Dealer Price का फायदा उठाने का मौका। आज ही Order करें!" },
    { title: "⏳ Dealer Price का फायदा उठाने का मौका।", body: "कीमतें बढ़ने से पहले आज ही ऑर्डर करें।" },
    { title: "🔥 Popular Products तेजी से Out of Stock हो रहे हैं।", body: "अपना मनपसंद स्टॉक खत्म होने से पहले खरीदें।" }
  ],

  // Trust Notifications
  TRUST: [
    { title: "✅ 100% Genuine Products", body: "कृषि क्रांति पर 100% असली प्रोडक्ट्स सीधे टॉप ब्रांड्स से पाएं।" },
    { title: "🚚 Fast Delivery Across India", body: "पूरे भारत में सुरक्षित और तेज़ डिलीवरी सीधे आपकी दुकान तक।" },
    { title: "🏪 Dealer Price Direct to Retailers", body: "बिचौलियों को हटाएं, सीधा होलसेल रेट पर खरीदें और ज्यादा मुनाफा कमाएं।" }
  ]
};

class PushNotificationSegmentService {

  /**
   * Get dynamic rotating template by day-of-year so users see varying messages
   */
  getNotificationForSegment(segment, dayOffset = 0) {
    const templates = SEGMENT_NOTIFICATIONS[segment];
    if (!templates || templates.length === 0) return null;

    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay) + dayOffset;

    return templates[dayOfYear % templates.length];
  }

  // Process items in parallel batches of 50 to avoid network congestion
  async processInBatches(items, batchSize, iteratorFn) {
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      await Promise.all(chunk.map(item => iteratorFn(item).catch(err => console.error('[Segment Batch Error]:', err.message))));
    }
  }

  /**
   * Get eligible users for a specific segment
   */
  async getEligibleUsersForSegment(segment) {
    const now = new Date();
    const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const validFcmTokenQuery = {
      isDeleted: { $ne: true },
      fcmToken: { $exists: true, $nin: [null, ''] }
    };

    switch (segment) {
      case 'A': // Installed → KYC Not Started (Daily, 3–5 days cap)
        return await User.find({
          ...validFcmTokenQuery,
          role: 'user',
          kycStatus: { $in: ['pending', 'not_started'] },
          isKycComplete: { $ne: true },
          $and: [
            { $or: [{ shopImage: { $exists: false } }, { shopImage: null }, { shopImage: '' }] },
            { $or: [{ licenceImage: { $exists: false } }, { licenceImage: null }, { licenceImage: '' }] },
            { $or: [{ gstNumber: { $exists: false } }, { gstNumber: null }, { gstNumber: '' }] },
            {
              $or: [
                { kycReminderCount: { $exists: false } },
                { kycReminderCount: { $lt: 5 } }
              ]
            },
            {
              $or: [
                { lastKycReminderSentAt: { $exists: false } },
                { lastKycReminderSentAt: null },
                { lastKycReminderSentAt: { $lt: startOfToday } }
              ]
            }
          ]
        });

      case 'B': // KYC Started → Docs Pending (Daily)
        return await User.find({
          ...validFcmTokenQuery,
          role: 'user',
          kycStatus: { $in: ['pending', 'rejected'] },
          isKycComplete: { $ne: true },
          $and: [
            {
              $or: [
                { shopImage: { $nin: [null, ''] } },
                { licenceImage: { $nin: [null, ''] } },
                { gstNumber: { $nin: [null, ''] } }
              ]
            },
            {
              $or: [
                { lastKycReminderSentAt: { $exists: false } },
                { lastKycReminderSentAt: null },
                { lastKycReminderSentAt: { $lt: startOfToday } }
              ]
            }
          ]
        });

      case 'C': // KYC Under Review (Once/day)
        return await User.find({
          ...validFcmTokenQuery,
          role: 'user',
          kycStatus: { $in: ['submitted', 'processing'] },
          $or: [
            { lastKycReminderSentAt: { $exists: false } },
            { lastKycReminderSentAt: null },
            { lastKycReminderSentAt: { $lt: startOfToday } }
          ]
        });

      case 'D': { // KYC Approved → No Order (Daily)
        const usersWithOrders = await Order.distinct('user', { orderStatus: { $ne: 'Cancelled' } });
        return await User.find({
          ...validFcmTokenQuery,
          _id: { $nin: usersWithOrders },
          kycStatus: 'verified',
          $or: [
            { lastMarketingNotificationSentAt: { $exists: false } },
            { lastMarketingNotificationSentAt: null },
            { lastMarketingNotificationSentAt: { $lt: startOfToday } }
          ]
        });
      }

      case 'E': { // Cart Abandoned (2 reminders max)
        const abandonedCarts = await Cart.find({
          items: { $exists: true, $not: { $size: 0 } },
          updatedAt: { $lt: thirtyMinsAgo, $gt: sevenDaysAgo },
          $or: [
            { reminderCount: { $exists: false } },
            { reminderCount: { $lt: 2 } }
          ],
          $and: [
            {
              $or: [
                { lastReminderSentAt: { $exists: false } },
                { lastReminderSentAt: null },
                { lastReminderSentAt: { $lt: oneDayAgo } }
              ]
            }
          ]
        }).populate('user');

        const userMap = new Map();
        for (const cart of abandonedCarts) {
          if (cart.user && cart.user.fcmToken && !userMap.has(cart.user._id.toString())) {
            cart.user._cartId = cart._id;
            userMap.set(cart.user._id.toString(), cart.user);
          }
        }
        return Array.from(userMap.values());
      }

      case 'F': { // Checkout / Payment Pending (2 reminders max)
        const pendingOrders = await Order.find({
          paymentStatus: 'Pending',
          orderStatus: { $nin: ['Cancelled', 'Delivered'] },
          createdAt: { $lt: thirtyMinsAgo, $gt: fortyEightHoursAgo }
        }).populate('user');

        const pendingSessions = await CheckoutSession.find({
          status: 'Pending',
          orderCreated: { $ne: true },
          createdAt: { $lt: thirtyMinsAgo, $gt: fortyEightHoursAgo },
          $or: [
            { reminderCount: { $exists: false } },
            { reminderCount: { $lt: 2 } }
          ]
        }).populate('user');

        const userMap = new Map();
        for (const o of pendingOrders) {
          if (o.user && o.user.fcmToken && (!o.user.lastMarketingNotificationSentAt || o.user.lastMarketingNotificationSentAt < oneDayAgo)) {
            userMap.set(o.user._id.toString(), o.user);
          }
        }
        for (const s of pendingSessions) {
          if (s.user && s.user.fcmToken && !userMap.has(s.user._id.toString()) && (!s.user.lastMarketingNotificationSentAt || s.user.lastMarketingNotificationSentAt < oneDayAgo)) {
            s.user._sessionId = s._id;
            userMap.set(s.user._id.toString(), s.user);
          }
        }
        return Array.from(userMap.values());
      }

      case 'G': { // Ordered Once (Repeat purchase after 7–15 days)
        const onceUserStats = await Order.aggregate([
          { $match: { orderStatus: { $ne: 'Cancelled' } } },
          { $group: { _id: "$user", count: { $sum: 1 }, lastOrderDate: { $max: "$createdAt" } } },
          { $match: { count: 1, lastOrderDate: { $lte: sevenDaysAgo } } }
        ]);
        const onceUserIds = onceUserStats.map(r => r._id);

        return await User.find({
          ...validFcmTokenQuery,
          _id: { $in: onceUserIds },
          $or: [
            { lastMarketingNotificationSentAt: { $exists: false } },
            { lastMarketingNotificationSentAt: null },
            { lastMarketingNotificationSentAt: { $lt: sevenDaysAgo } }
          ]
        });
      }

      case 'H': { // Active Buyers (2–3 / week)
        const multiUserStats = await Order.aggregate([
          { $match: { orderStatus: { $ne: 'Cancelled' } } },
          { $group: { _id: "$user", count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } }
        ]);
        const multiUserIds = multiUserStats.map(r => r._id);

        return await User.find({
          ...validFcmTokenQuery,
          _id: { $in: multiUserIds },
          $or: [
            { lastMarketingNotificationSentAt: { $exists: false } },
            { lastMarketingNotificationSentAt: null },
            { lastMarketingNotificationSentAt: { $lt: threeDaysAgo } }
          ]
        });
      }

      case 'I': { // High Value Dealers (Weekly)
        const highValueStats = await Order.aggregate([
          { $match: { orderStatus: { $ne: 'Cancelled' } } },
          { $group: { _id: "$user", totalSpent: { $sum: "$totalAmount" }, maxSingleOrder: { $max: "$totalAmount" } } },
          { $match: { $or: [{ totalSpent: { $gte: 50000 } }, { maxSingleOrder: { $gte: 50000 } }] } }
        ]);
        const highValueIds = highValueStats.map(r => r._id);

        return await User.find({
          ...validFcmTokenQuery,
          _id: { $in: highValueIds },
          $or: [
            { lastMarketingNotificationSentAt: { $exists: false } },
            { lastMarketingNotificationSentAt: null },
            { lastMarketingNotificationSentAt: { $lt: sevenDaysAgo } }
          ]
        });
      }

      case 'J': { // Inactive 30+ Days (Weekly)
        const recentActiveUsers = await Order.distinct('user', {
          orderStatus: { $ne: 'Cancelled' },
          createdAt: { $gte: thirtyDaysAgo }
        });

        return await User.find({
          ...validFcmTokenQuery,
          _id: { $nin: recentActiveUsers },
          kycStatus: 'verified',
          createdAt: { $lte: thirtyDaysAgo },
          $or: [
            { lastMarketingNotificationSentAt: { $exists: false } },
            { lastMarketingNotificationSentAt: null },
            { lastMarketingNotificationSentAt: { $lt: sevenDaysAgo } }
          ]
        });
      }

      case 'SEASONAL':
      case 'TRUST':
      case 'URGENCY': {
        return await User.find({
          ...validFcmTokenQuery,
          $or: [
            { lastMarketingNotificationSentAt: { $exists: false } },
            { lastMarketingNotificationSentAt: null },
            { lastMarketingNotificationSentAt: { $lt: oneDayAgo } }
          ]
        });
      }

      default:
        return [];
    }
  }

  /**
   * Dispatches notifications to all eligible users in a given segment
   */
  async sendToSegment(segment, customTemplate = null) {
    console.log(`[SegmentService] Processing Segment ${segment}...`);
    const template = customTemplate || this.getNotificationForSegment(segment);
    if (!template) {
      console.warn(`[SegmentService] No template found for segment ${segment}`);
      return { count: 0, segment };
    }

    const users = await this.getEligibleUsersForSegment(segment);
    console.log(`[SegmentService] Segment ${segment}: Found ${users.length} eligible users with active FCM tokens.`);

    if (users.length === 0) {
      return { count: 0, segment };
    }

    const now = new Date();
    const isUtility = ['A', 'B', 'C'].includes(segment);
    let targetRoute = '/dashboard';

    if (['A', 'B', 'C'].includes(segment)) {
      targetRoute = '/kyc';
    } else if (['E', 'F'].includes(segment)) {
      targetRoute = '/cart';
    }

    let dispatchedCount = 0;

    await this.processInBatches(users, 50, async (user) => {
      try {
        if (isUtility) {
          await notificationService.sendUtilityNotification(user._id, template.title, template.body, targetRoute);
          await User.findByIdAndUpdate(user._id, {
            $set: { lastKycReminderSentAt: now },
            $inc: { kycReminderCount: 1 }
          });
        } else {
          await notificationService.sendMarketingNotification(user._id, template.title, template.body, targetRoute);
          await User.findByIdAndUpdate(user._id, {
            $set: { lastMarketingNotificationSentAt: now, lastMarketingSegment: segment }
          });
        }

        if (segment === 'E' && user._cartId) {
          await Cart.findByIdAndUpdate(user._cartId, {
            $set: { lastReminderSentAt: now },
            $inc: { reminderCount: 1 }
          });
        }

        if (segment === 'F' && user._sessionId) {
          await CheckoutSession.findByIdAndUpdate(user._sessionId, {
            $set: { lastReminderSentAt: now },
            $inc: { reminderCount: 1 }
          });
        }

        dispatchedCount++;
      } catch (err) {
        console.error(`[SegmentService] Error dispatching to user ${user._id}:`, err.message);
      }
    });

    console.log(`[SegmentService] Segment ${segment}: Completed sending ${dispatchedCount} notifications.`);
    return { count: dispatchedCount, segment };
  }

  // 9:00 AM – KYC Reminders (Segment A, B, C)
  async trigger9AMJobs() {
    console.log('[SegmentService] --- Triggering 9:00 AM KYC Reminder Jobs ---');
    const resA = await this.sendToSegment('A');
    const resB = await this.sendToSegment('B');
    const resC = await this.sendToSegment('C');
    return { A: resA.count, B: resB.count, C: resC.count };
  }

  // 11:30 AM – First Order Reminders (Segment D)
  async trigger1130AMJobs() {
    console.log('[SegmentService] --- Triggering 11:30 AM First Order Job ---');
    const resD = await this.sendToSegment('D');
    return { D: resD.count };
  }

  // 2:00 PM – Cart & Checkout Recovery (Segment E, F)
  async trigger2PMJobs() {
    console.log('[SegmentService] --- Triggering 2:00 PM Cart & Checkout Recovery Jobs ---');
    const resE = await this.sendToSegment('E');
    const resF = await this.sendToSegment('F');
    return { E: resE.count, F: resF.count };
  }

  // 5:30 PM – New Arrivals & Offers (Segment H, I + Seasonal/Trust fallback)
  async trigger530PMJobs() {
    console.log('[SegmentService] --- Triggering 5:30 PM New Arrivals & Offers Jobs ---');
    const resH = await this.sendToSegment('H');
    const resI = await this.sendToSegment('I');

    // If active buyers or VIP buyers were reached, they already got specific H/I content.
    // For all other app users who have not received marketing today, send Seasonal / Trust / New Arrivals broadcast
    const randomFallbackType = Math.random() > 0.5 ? 'SEASONAL' : 'TRUST';
    const fallbackTemplate = this.getNotificationForSegment(randomFallbackType);
    const fallbackUsers = await User.find({
      fcmToken: { $exists: true, $nin: [null, ''] },
      $or: [
        { lastMarketingNotificationSentAt: { $exists: false } },
        { lastMarketingNotificationSentAt: null },
        { lastMarketingNotificationSentAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      ]
    });

    console.log(`[SegmentService] 5:30 PM ${randomFallbackType} broadcast eligible users: ${fallbackUsers.length}`);
    let fallbackCount = 0;
    const now = new Date();
    await this.processInBatches(fallbackUsers, 50, async (u) => {
      await notificationService.sendMarketingNotification(u._id, fallbackTemplate.title, fallbackTemplate.body, '/dashboard');
      await User.findByIdAndUpdate(u._id, {
        $set: { lastMarketingNotificationSentAt: now, lastMarketingSegment: randomFallbackType }
      });
      fallbackCount++;
    });

    return { H: resH.count, I: resI.count, fallbackType: randomFallbackType, fallbackCount };
  }

  // 8:00 PM – Urgency & Win-back (Segment G, J + Urgency broadcast)
  async trigger8PMJobs() {
    console.log('[SegmentService] --- Triggering 8:00 PM Urgency & Win-back Jobs ---');
    const resG = await this.sendToSegment('G');
    const resJ = await this.sendToSegment('J');

    // For all other app users who have not received marketing today, send Urgency broadcast
    const urgencyTemplate = this.getNotificationForSegment('URGENCY');
    const urgencyUsers = await User.find({
      fcmToken: { $exists: true, $nin: [null, ''] },
      $or: [
        { lastMarketingNotificationSentAt: { $exists: false } },
        { lastMarketingNotificationSentAt: null },
        { lastMarketingNotificationSentAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      ]
    });

    console.log(`[SegmentService] 8:00 PM URGENCY broadcast eligible users: ${urgencyUsers.length}`);
    let urgencyCount = 0;
    const now = new Date();
    await this.processInBatches(urgencyUsers, 50, async (u) => {
      await notificationService.sendMarketingNotification(u._id, urgencyTemplate.title, urgencyTemplate.body, '/dashboard');
      await User.findByIdAndUpdate(u._id, {
        $set: { lastMarketingNotificationSentAt: now, lastMarketingSegment: 'URGENCY' }
      });
      urgencyCount++;
    });

    return { G: resG.count, J: resJ.count, urgencyCount };
  }

  /**
   * Diagnostic summary of all segments and total user counts
   */
  async getSegmentStats() {
    const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
    const usersWithToken = await User.countDocuments({ fcmToken: { $exists: true, $nin: [null, ''] }, isDeleted: { $ne: true } });

    const stats = {};
    const segments = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'SEASONAL', 'URGENCY', 'TRUST'];

    for (const seg of segments) {
      const eligible = await this.getEligibleUsersForSegment(seg);
      stats[seg] = {
        eligibleCount: eligible.length,
        templateCount: (SEGMENT_NOTIFICATIONS[seg] || []).length,
        todayTemplate: this.getNotificationForSegment(seg)
      };
    }

    return {
      totalUsers,
      usersWithToken,
      segments: stats
    };
  }
}

module.exports = new PushNotificationSegmentService();