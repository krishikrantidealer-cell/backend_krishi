const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const notificationService = require('./notification.service');

const SEGMENT_NOTIFICATIONS = {
  A: [
    { title: "🔓 Dealer Price Unlock करें!", body: "बस Shop Photo और License Upload करें। KYC पूरा होते ही Wholesale Rates दिखाई देंगे।" },
    { title: "🏪 आपकी दुकान तैयार है?", body: "अब सिर्फ KYC Complete करें और Bulk Purchase शुरू करें।" },
    { title: "💰 Retail नहीं... Dealer Price पर खरीदें!", body: "KYC पूरा करें और ज्यादा Margin कमाएँ।" },
    { title: "⚡ 2 मिनट का काम...", body: "Shop Photo Upload करें, Wholesale Price Unlock करें।" },
    { title: "📦 Bulk खरीदारी अब आसान है!", body: "KYC Complete करें और हजारों Products Dealer Rate पर खरीदें." }
  ],
  B: [
    { title: "📄 आपका KYC अधूरा है।", body: "बस बाकी Documents Upload करें और Approval प्राप्त करें।" },
    { title: "⏳ आपका Approval आपका इंतजार कर रहा है।", body: "Remaining Documents Upload करें।" },
    { title: "🚀 Wholesale Buying से बस एक कदम दूर।", body: "KYC Complete करें और Dealer Prices देखें." }
  ],
  C: [
    { title: "✅ आपका KYC Review में है।", body: "Approval मिलते ही Notification भेज दी जाएगी।" },
    { title: "🔍 आपका Verification चल रहा है।", body: "थोड़ा इंतजार करें। जल्द ही Dealer Prices Unlock हो जाएंगी।" }
  ],
  D: [
    { title: "🎉 आपका KYC Approved हो गया!", body: "अब Dealer Price पर अपना पहला Order Place करें।" },
    { title: "📦 Stock भरने का सही समय!", body: "Wholesale Price Unlock हो चुकी है। आज ही पहला Order करें।" },
    { title: "💸 ज्यादा Margin कमाने का मौका!", body: "Bulk खरीदें और ज्यादा Profit कमाएँ।" },
    { title: "🚚 Fast Delivery + Wholesale Rates.", body: "अब पहला Order Place करें।" },
    { title: "🎯 Dealer बनने का अगला कदम...", body: "पहला Order करें और Business बढ़ाएँ।" }
  ],
  E: [
    { title: "🛒 आपका Cart आपका इंतजार कर रहा है।", body: "Order Complete करें और Fast Delivery पाएँ।" },
    { title: "⏰ Cart में Products अभी भी मौजूद हैं।", body: "Checkout पूरा करें।" },
    { title: "🚚 जल्दी करें!", body: "आपका Bulk Order अभी भी Pending है." }
  ],
  F: [
    { title: "💳 आपका Payment Pending है।", body: "Order Complete करें और Dispatch शुरू करवाएँ।" },
    { title: "📦 आपका Order तैयार है।", body: "बस Payment Complete करें।" },
    { title: "🚀 जल्दी करें!", body: "Payment Complete होते ही Order Dispatch होगा।" }
  ],
  G: [
    { title: "📈 Stock खत्म होने का इंतजार क्यों?", body: "आज ही Bulk Order करें।" },
    { title: "🚚 Fast Delivery के साथ फिर से Order करें।", body: "Wholesale Rates आपका इंतजार कर रही हैं।" },
    { title: "🌾 अपने Business की Supply बनाए रखें।", body: "Bulk Order करें।" },
    { title: "💰 ज्यादा खरीदें... ज्यादा बचत करें।", body: "बेहतर मुनाफे के लिए आज ही ऑर्डर करें।" }
  ],
  H: [
    { title: "🆕 नए Products आ चुके हैं!", body: "नई Range देखें और सबसे पहले Order करें।" },
    { title: "🌱 आपके लिए नए Agro Products Available हैं।", body: "App खोलें और देखें।" },
    { title: "🔥 Best Selling Products की नई Range Available।", body: "अभी देखें।" }
  ],
  I: [
    { title: "🎁 ₹50,000+ Order पर Special Surprise!", body: "Bulk खरीदारी करें और पाएँ FREE 10L Product.*" },
    { title: "🏆 बड़े Dealers के लिए Exclusive Benefit!", body: "₹50,000+ खरीदें और Surprise Gift पाएँ।" },
    { title: "🚛 बड़ा Stock... बड़ा फायदा...", body: "₹50,000+ Order करें।" }
  ],
  J: [
    { title: "👋 काफी समय हो गया...", body: "फिर से Wholesale Price पर खरीदारी शुरू करें।" },
    { title: "📦 आपका Dealer Account अभी भी Active है।", body: "आज ही Bulk Order करें।" },
    { title: "💰 Business को दोबारा Growth दें।", body: "Wholesale Rates आपका इंतजार कर रही हैं।" }
  ],
  URGENCY: [
    { title: "⚡ आज Order, जल्दी Dispatch!", body: "देरी न करें, आज ही अपना स्टॉक बुक करें।" },
    { title: "⏳ Dealer Price का फायदा उठाने का मौका।", body: "कीमतें बढ़ने से पहले ऑर्डर करें।" },
    { title: "🔥 Popular Products तेजी से Out of Stock हो रहे हैं।", body: "अपना मनपसंद स्टॉक खत्म होने से पहले खरीदें।" }
  ],
  SEASONAL: [
    { title: "🌧️ खरीफ Season शुरू!", body: "आज ही Bulk Stock करें और Demand बढ़ने से पहले तैयारी करें।" },
    { title: "🌾 सीजन की तैयारी अभी से करें।", body: "Wholesale Rate पर Bulk खरीदारी का सही समय।" },
    { title: "🚜 किसानों की Demand बढ़ रही है।", body: "Stock पहले भरें, Profit ज्यादा कमाएँ।" }
  ],
  TRUST: [
    { title: "✅ 100% Genuine Products", body: "कृषि क्रांति पर भरोसा करें, सीधा कंपनी से पायें।" },
    { title: "🚚 Fast Delivery Across India", body: "आपका आर्डर अब और भी तेज़ पहुंचेगा।" },
    { title: "🏪 Dealer Price Direct to Retailers", body: "बिचौलियों को हटाएं, सीधा होलसेल रेट पर पायें।" }
  ]
};

class PushNotificationSegmentService {

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

  async sendToSegment(segment) {
    console.log(`[SegmentService] Processing Segment ${segment}...`);
    const template = this.getNotificationForSegment(segment);
    if (!template) return;

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let users = [];

    switch (segment) {
      case 'A': // KYC Not Started
        users = await User.find({
          kycStatus: 'pending',
          shopImage: { $exists: false },
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastKycReminderSentAt: { $exists: false } }, { lastKycReminderSentAt: { $lt: oneDayAgo } }]
        });
        break;

      case 'B': // Docs Pending
        users = await User.find({
          kycStatus: { $in: ['pending', 'rejected'] },
          $or: [{ shopImage: { $exists: true } }, { licenceImage: { $exists: true } }],
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastKycReminderSentAt: { $exists: false } }, { lastKycReminderSentAt: { $lt: oneDayAgo } }]
        });
        break;

      case 'C': // Under Review
        users = await User.find({
          kycStatus: { $in: ['submitted', 'processing'] },
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastKycReminderSentAt: { $exists: false } }, { lastKycReminderSentAt: { $lt: oneDayAgo } }]
        });
        break;

      case 'D': // Approved -> No Order
        const usersWithOrders = await Order.distinct('user');
        users = await User.find({
          _id: { $nin: usersWithOrders },
          kycStatus: 'verified',
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastMarketingNotificationSentAt: { $exists: false } }, { lastMarketingNotificationSentAt: { $lt: oneDayAgo } }]
        });
        break;

      case 'E': // Cart Abandoned
        const carts = await Cart.find({
          items: { $exists: true, $not: { $size: 0 } },
          $or: [{ lastReminderSentAt: { $exists: false } }, { lastReminderSentAt: { $lt: oneDayAgo } }]
        }).populate('user');
        users = carts.filter(c => c.user && c.user.fcmToken).map(c => c.user);
        break;

      case 'F': // Payment Pending
        const orders = await Order.find({
          paymentStatus: 'Pending',
          createdAt: { $lt: oneDayAgo }
        }).populate('user');
        users = [...new Set(orders
          .filter(o => o.user && o.user.fcmToken && (!o.user.lastMarketingNotificationSentAt || o.user.lastMarketingNotificationSentAt < oneDayAgo))
          .map(o => o.user))];
        break;

      case 'G': // Ordered Once
        const onceUserIds = await Order.aggregate([
          { $group: { _id: "$user", count: { $sum: 1 } } },
          { $match: { count: 1 } }
        ]).then(res => res.map(r => r._id));

        users = await User.find({
          _id: { $in: onceUserIds },
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastMarketingNotificationSentAt: { $exists: false } }, { lastMarketingNotificationSentAt: { $lt: sevenDaysAgo } }]
        });
        break;

      case 'H': // Active Buyers
        const multiUserIds = await Order.aggregate([
          { $group: { _id: "$user", count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } }
        ]).then(res => res.map(r => r._id));

        users = await User.find({
          _id: { $in: multiUserIds },
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastMarketingNotificationSentAt: { $exists: false } }, { lastMarketingNotificationSentAt: { $lt: threeDaysAgo } }]
        });
        break;

      case 'I': // High Value
        const highValueIds = await Order.distinct('user', { totalAmount: { $gte: 50000 } });
        users = await User.find({
          _id: { $in: highValueIds },
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastMarketingNotificationSentAt: { $exists: false } }, { lastMarketingNotificationSentAt: { $lt: sevenDaysAgo } }]
        });
        break;

      case 'J': // Inactive
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        users = await User.find({
          updatedAt: { $lt: thirtyDaysAgo },
          fcmToken: { $exists: true, $ne: null },
          $or: [{ lastMarketingNotificationSentAt: { $exists: false } }, { lastMarketingNotificationSentAt: { $lt: sevenDaysAgo } }]
        });
        break;
    }

    console.log(`[SegmentService] Sending to ${users.length} users in Segment ${segment}`);
    for (const user of users) {
      try {
        const isUtility = ['A', 'B', 'C'].includes(segment);
        const route = segment === 'E' ? '/cart' : (isUtility ? '/profile' : '/');

        if (isUtility) {
          await notificationService.sendUtilityNotification(user._id, template.title, template.body, route);
          user.lastKycReminderSentAt = now;
        } else {
          await notificationService.sendMarketingNotification(user._id, template.title, template.body, route);
          user.lastMarketingNotificationSentAt = now;
        }

        if (segment === 'E') await Cart.updateOne({ user: user._id }, { lastReminderSentAt: now });
        await user.save();
      } catch (e) {
        console.error(`Error sending to user ${user._id}:`, e.message);
      }
    }
  }

  async trigger9AMJobs() { await this.sendToSegment('A'); await this.sendToSegment('B'); await this.sendToSegment('C'); }
  async trigger1130AMJobs() { await this.sendToSegment('D'); }
  async trigger2PMJobs() { await this.sendToSegment('E'); await this.sendToSegment('F'); }
  async trigger530PMJobs() {
    await this.sendToSegment('H'); await this.sendToSegment('I');
    // Randomly pick Seasonal or Trust to keep it fresh
    const type = Math.random() > 0.5 ? 'SEASONAL' : 'TRUST';
    const template = this.getNotificationForSegment(type);
    const users = await User.find({ fcmToken: { $exists: true }, lastMarketingNotificationSentAt: { $lt: new Date(Date.now() - 24*60*60*1000) } }).limit(200);
    for(const u of users) { await notificationService.sendMarketingNotification(u._id, template.title, template.body, '/'); u.lastMarketingNotificationSentAt = new Date(); await u.save(); }
  }
  async trigger8PMJobs() {
    await this.sendToSegment('G'); await this.sendToSegment('J');
    const template = this.getNotificationForSegment('URGENCY');
    const users = await User.find({ status: 'prospect', fcmToken: { $exists: true }, lastMarketingNotificationSentAt: { $lt: new Date(Date.now() - 24*60*60*1000) } }).limit(200);
    for(const u of users) { await notificationService.sendMarketingNotification(u._id, template.title, template.body, '/'); u.lastMarketingNotificationSentAt = new Date(); await u.save(); }
  }
}

module.exports = new PushNotificationSegmentService();