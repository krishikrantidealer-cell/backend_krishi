
function interpolatePlaceholders(text, user) {
  if (!text || typeof text !== 'string') return text || '';
  const rawName = (user?.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : (user?.name || '')).trim();
  const dealerName = rawName || 'Dealer';
  const rawShopName = (user?.shopName || user?.businessName || user?.storeName || '').trim();
  const shopName = rawShopName || 'आपकी दुकान';

  return text
    .replace(/\{\{\s*name\s*\}\}/gi, dealerName)
    .replace(/\{\{\s*dealerName\s*\}\}/gi, dealerName)
    .replace(/\{\{\s*shopName\s*\}\}/gi, shopName)
    .replace(/\{\{\s*shopname\s*\}\}/gi, shopName)
    .replace(/\{\{\s*dukaan\s*\}\}/gi, shopName);
}

const User = require("../models/User");
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const CheckoutSession = require("../models/CheckoutSession");
const NotificationCampaign = require("../models/NotificationCampaign");
const notificationService = require("./notification.service");

// Calculate Midnight IST (UTC + 5:30)
const getStartOfTodayIST = () => {
  const now = new Date();
  const kolkataMillis = now.getTime() + (5.5 * 60 * 60 * 1000);
  const kolkataDate = new Date(kolkataMillis);
  const year = kolkataDate.getUTCFullYear();
  const month = kolkataDate.getUTCMonth();
  const date = kolkataDate.getUTCDate();
  // Midnight in IST converted back to UTC
  return new Date(Date.UTC(year, month, date, 0, 0, 0) - (5.5 * 60 * 60 * 1000));
};

const GCS_BANNER_BASE_URL = "https://storage.googleapis.com/krishi-product-images/push_banners";

const BANNERS = {
  KYC_1: `${GCS_BANNER_BASE_URL}/kyc1.png`,
  KYC_2: `${GCS_BANNER_BASE_URL}/kyc2.png`,
  MARKETING_1: `${GCS_BANNER_BASE_URL}/marketing1.png`,
  MARKETING_2: `${GCS_BANNER_BASE_URL}/marketing2.png`,
  MARKETING_3: `${GCS_BANNER_BASE_URL}/marketing3.png`,
  MARKETING_4: `${GCS_BANNER_BASE_URL}/marketing4.png`,
};

// Initial Seed Data if DB is empty
const INITIAL_CAMPAIGNS_SEED = [
  {
    segmentKey: "A",
    name: "Segment A – Installed App → KYC Not Started",
    description: "Dealers who downloaded the app but haven't started uploading KYC documents.",
    goal: "Complete KYC",
    category: "kyc",
    isEnabled: true,
    scheduledTime: "09:00",
    mode: "rotating",
    targetRoute: "/kyc",
    templates: [
      { title: "🔓 Dealer Price Unlock करें!", body: "बस Shop Photo और License Upload करें। KYC पूरा होते ही Wholesale Rates दिखाई देंगे।", imageUrl: BANNERS.KYC_1, actionRoute: "/kyc", isEnabled: true },
      { title: "🏪 आपकी दुकान तैयार है?", body: "अब सिर्फ KYC Complete करें और Bulk Purchase शुरू करें।", imageUrl: BANNERS.KYC_2, actionRoute: "/kyc", isEnabled: true },
      { title: "💰 Retail नहीं... Dealer Price पर खरीदें!", body: "KYC पूरा करें और ज्यादा Margin कमाएँ।", imageUrl: BANNERS.KYC_1, actionRoute: "/kyc", isEnabled: true },
      { title: "⚡ 2 मिनट का काम...", body: "Shop Photo Upload करें, Wholesale Price Unlock करें।", imageUrl: BANNERS.KYC_2, actionRoute: "/kyc", isEnabled: true },
      { title: "📦 Bulk खरीदारी अब आसान है!", body: "KYC Complete करें और हजारों Products Dealer Rate पर खरीदें.", imageUrl: BANNERS.KYC_1, actionRoute: "/kyc", isEnabled: true }
    ]
  },
  {
    segmentKey: "B",
    name: "Segment B – KYC Started → Docs Pending",
    description: "Dealers who uploaded partial KYC documents or were rejected and need to re-upload.",
    goal: "Complete KYC",
    category: "kyc",
    isEnabled: true,
    scheduledTime: "09:00",
    mode: "rotating",
    targetRoute: "/kyc",
    templates: [
      { title: "📄 आपका KYC अधूरा है।", body: "बस बाकी Documents Upload करें और Approval प्राप्त करें।", imageUrl: BANNERS.KYC_2, actionRoute: "/kyc", isEnabled: true },
      { title: "⏳ आपका Approval आपका इंतजार कर रहा है।", body: "Remaining Documents Upload करें।", imageUrl: BANNERS.KYC_1, actionRoute: "/kyc", isEnabled: true },
      { title: "🚀 Wholesale Buying से बस एक कदम दूर।", body: "KYC Complete करें और Dealer Prices देखें.", imageUrl: BANNERS.KYC_2, actionRoute: "/kyc", isEnabled: true }
    ]
  },
  {
    segmentKey: "C",
    name: "Segment C – KYC Under Review",
    description: "Dealers whose KYC is currently submitted and under review by operations team.",
    goal: "Reduce Verification Anxiety",
    category: "kyc",
    isEnabled: true,
    scheduledTime: "09:00",
    mode: "rotating",
    targetRoute: "/kyc",
    templates: [
      { title: "✅ आपका KYC Review में है।", body: "Approval मिलते ही Notification भेज दी जाएगी।", imageUrl: BANNERS.KYC_1, actionRoute: "/kyc", isEnabled: true },
      { title: "🔍 आपका Verification चल रहा है।", body: "थोड़ा इंतजार करें। जल्द ही Dealer Prices Unlock हो जाएंगी।", imageUrl: BANNERS.KYC_2, actionRoute: "/kyc", isEnabled: true }
    ]
  },
  {
    segmentKey: "D",
    name: "Segment D – KYC Approved → No Order",
    description: "Dealers who are approved but haven't placed their first order yet.",
    goal: "First Wholesale Purchase",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "11:30",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "🎉 आपका KYC Approved हो गया!", body: "अब Dealer Price पर अपना पहला Order Place करें।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true },
      { title: "📦 Stock भरने का सही समय!", body: "Wholesale Price Unlock हो चुकी है। आज ही पहला Order करें।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true },
      { title: "💸 ज्यादा Margin कमाने का मौका!", body: "Bulk खरीदें और ज्यादा Profit कमाएँ।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true },
      { title: "🚚 Fast Delivery + Wholesale Rates.", body: "अब पहला Order Place करें।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🎯 Dealer बनने का अगला कदम...", body: "पहला Order करें और Business बढ़ाएँ।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "E",
    name: "Segment E – Cart Abandoned",
    description: "Dealers with items added to cart who haven't completed checkout.",
    goal: "Recover Cart",
    category: "cart",
    isEnabled: true,
    scheduledTime: "14:00",
    mode: "rotating",
    targetRoute: "/cart",
    templates: [
      { title: "🛒 आपका Cart आपका इंतजार कर रहा है।", body: "Order Complete करें और Fast Delivery पाएँ।", imageUrl: BANNERS.MARKETING_2, actionRoute: "/cart", isEnabled: true },
      { title: "⏰ Cart में Products अभी भी मौजूद हैं।", body: "Checkout पूरा करें।", imageUrl: BANNERS.MARKETING_2, actionRoute: "/cart", isEnabled: true },
      { title: "🚚 जल्दी करें!", body: "आपका Bulk Order अभी भी Pending है.", imageUrl: BANNERS.MARKETING_2, actionRoute: "/cart", isEnabled: true }
    ]
  },
  {
    segmentKey: "F",
    name: "Segment F – Payment / Checkout Pending",
    description: "Dealers with initiated orders or checkout sessions pending payment.",
    goal: "Complete Payment",
    category: "order",
    isEnabled: true,
    scheduledTime: "14:00",
    mode: "rotating",
    targetRoute: "/cart",
    templates: [
      { title: "💳 आपका Payment Pending है।", body: "Order Complete करें और Dispatch शुरू करवाएँ।", imageUrl: BANNERS.MARKETING_2, actionRoute: "/cart", isEnabled: true },
      { title: "📦 आपका Order तैयार है।", body: "बस Payment Complete करें।", imageUrl: BANNERS.MARKETING_2, actionRoute: "/cart", isEnabled: true },
      { title: "🚀 जल्दी करें!", body: "Payment Complete होते ही Order Dispatch होगा।", imageUrl: BANNERS.MARKETING_2, actionRoute: "/cart", isEnabled: true }
    ]
  },
  {
    segmentKey: "G",
    name: "Segment G – Ordered Once",
    description: "Dealers who placed exactly 1 order and are ready for re-ordering after 7+ days.",
    goal: "Repeat Purchase",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "20:00",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "📈 Stock खत्म होने का इंतजार क्यों?", body: "आज ही Bulk Order करें।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true },
      { title: "🚚 Fast Delivery के साथ फिर से Order करें।", body: "Wholesale Rates आपका इंतजार कर रही हैं।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🌾 अपने Business की Supply बनाए रखें।", body: "Bulk Order करें।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true },
      { title: "💰 ज्यादा खरीदें... ज्यादा बचत करें।", body: "Wholesale Rates पर फिर से Order करें और ज्यादा Profit कमाएँ।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "H",
    name: "Segment H – Active Buyers / New Products",
    description: "Active buyers with multiple orders to introduce new catalog arrivals.",
    goal: "Cross-sell / Catalog Discovery",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "17:30",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "🆕 नए Products आ चुके हैं!", body: "नई Range देखें और सबसे पहले Order करें।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🌱 आपके लिए नए Agro Products Available हैं।", body: "App खोलें और देखें।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🔥 Best Selling Products की नई Range Available।", body: "अभी देखें और Bulk Order करें।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "I",
    name: "Segment I – High Value Dealers",
    description: "Dealers with total lifetime spend >= ₹50,000 or single order >= ₹50,000.",
    goal: "VIP Offers & Loyalty",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "17:30",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "🎁 ₹50,000+ Order पर Special Surprise!", body: "Bulk खरीदारी करें और पाएँ FREE 10L Product.*", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true },
      { title: "🏆 बड़े Dealers के लिए Exclusive Benefit!", body: "₹50,000+ खरीदें और Surprise Gift पाएँ।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🚛 बड़ा Stock... बड़ा फायदा...", body: "₹50,000+ Order करें और Exclusive Discounts पाएँ।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "J",
    name: "Segment J – Inactive Dealers 30+ Days",
    description: "Verified dealers with no orders placed in the last 30 days.",
    goal: "Win-back Inactive Dealers",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "20:00",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "👋 काफी समय हो गया...", body: "फिर से Wholesale Price पर खरीदारी शुरू करें।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true },
      { title: "📦 आपका Dealer Account अभी भी Active है।", body: "आज ही Bulk Order करें।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true },
      { title: "💰 Business को दोबारा Growth दें।", body: "Wholesale Rates आपका इंतजार कर रही हैं।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "SEASONAL",
    name: "Seasonal Demand Notifications",
    description: "Broadcasted to all dealers for seasonal agriculture stocking surges.",
    goal: "Seasonal Urgency & Stocking",
    category: "seasonal",
    isEnabled: true,
    scheduledTime: "17:30",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "🌧️ खरीफ Season शुरू!", body: "आज ही Bulk Stock करें और Demand बढ़ने से पहले तैयारी करें।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🌾 सीजन की तैयारी अभी से करें।", body: "Wholesale Rate पर Bulk खरीदारी का सही समय।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🚜 किसानों की Demand बढ़ रही है।", body: "Stock पहले भरें, Profit ज्यादा कमाएँ।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "URGENCY",
    name: "Urgency Broadcast Notifications",
    description: "Evening conversion triggers for low stock or special price window alerts.",
    goal: "Same-Day Conversion Push",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "20:00",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "⚡ आज Order, जल्दी Dispatch!", body: "Dealer Price का फायदा उठाने का मौका। आज ही Order करें!", imageUrl: BANNERS.MARKETING_2, actionRoute: "/dashboard", isEnabled: true },
      { title: "⏳ Dealer Price का फायदा उठाने का मौका।", body: "कीमतें बढ़ने से पहले आज ही ऑर्डर करें।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true },
      { title: "🔥 Popular Products तेजी से Out of Stock हो रहे हैं।", body: "अपना मनपसंद स्टॉक खत्म होने से पहले खरीदें।", imageUrl: BANNERS.MARKETING_2, actionRoute: "/dashboard", isEnabled: true }
    ]
  },
  {
    segmentKey: "TRUST",
    name: "Platform Trust Notifications",
    description: "Assurance messages highlighting genuine products, direct pricing, and delivery speed.",
    goal: "Build Dealer Trust",
    category: "marketing",
    isEnabled: true,
    scheduledTime: "17:30",
    mode: "rotating",
    targetRoute: "/dashboard",
    templates: [
      { title: "✅ 100% Genuine Products", body: "कृषि क्रांति पर 100% असली प्रोडक्ट्स सीधे टॉप ब्रांड्स से पाएं।", imageUrl: BANNERS.MARKETING_1, actionRoute: "/dashboard", isEnabled: true },
      { title: "🚚 Fast Delivery Across India", body: "पूरे भारत में सुरक्षित और तेज़ डिलीवरी सीधे आपकी दुकान तक।", imageUrl: BANNERS.MARKETING_4, actionRoute: "/dashboard", isEnabled: true },
      { title: "🏪 Dealer Price Direct to Retailers", body: "बिचौलियों को हटाएं, सीधा होलसेल रेट पर खरीदें और ज्यादा मुनाफा कमाएं।", imageUrl: BANNERS.MARKETING_3, actionRoute: "/dashboard", isEnabled: true }
    ]
  }
];

class PushNotificationSegmentService {

  /**
   * Automatically seed database with default segments if empty
   */
  async ensureSeedCampaigns() {
    try {
      const count = await NotificationCampaign.countDocuments();
      if (count === 0) {
        console.log("[PushCampaigns] Seeding initial dynamic campaigns into MongoDB...");
        await NotificationCampaign.insertMany(INITIAL_CAMPAIGNS_SEED);
        console.log("[PushCampaigns] Successfully seeded 13 default dynamic notification campaigns.");
      }
    } catch (err) {
      console.error("[PushCampaigns] Error seeding campaigns:", err.message);
    }
  }

  /**
   * Helper to replace dynamic personalization variables in copy
   */
  hydrateVariables(text, user) {
    if (!text) return "";
    let hydrated = text;
    const name = user.firstName || user.name || "Dealer";
    const shopName = user.shopName || user.businessName || "आपकी दुकान";
    
    hydrated = hydrated.replace(/{{\s*name\s*}}/gi, name);
    hydrated = hydrated.replace(/{{\s*shopName\s*}}/gi, shopName);
    hydrated = hydrated.replace(/{{\s*phone\s*}}/gi, user.phoneNumber || "");
    return hydrated;
  }

  /**
   * Get dynamic rotating, pinned, or random template for a segment from MongoDB
   */
  async getNotificationForSegment(segmentKey, user = null, dayOffset = 0) {
    const campaign = await NotificationCampaign.findOne({ segmentKey: segmentKey.toUpperCase() });
    if (!campaign || !campaign.isEnabled) return null;

    const activeTemplates = (campaign.templates || []).filter(t => t.isEnabled);
    if (activeTemplates.length === 0) return null;

    let selectedTemplate = null;

    // 1. Pinned Mode
    if (campaign.mode === "pinned" && campaign.pinnedTemplateId) {
      selectedTemplate = activeTemplates.find(t => t._id.toString() === campaign.pinnedTemplateId.toString());
    }

    // 2. Random Mode
    if (!selectedTemplate && campaign.mode === "random") {
      const randIdx = Math.floor(Math.random() * activeTemplates.length);
      selectedTemplate = activeTemplates[randIdx];
    }

    // 3. Rotating Mode (Default)
    if (!selectedTemplate) {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const diff = now - start;
      const oneDay = 1000 * 60 * 60 * 24;
      const dayOfYear = Math.floor(diff / oneDay) + dayOffset;
      selectedTemplate = activeTemplates[dayOfYear % activeTemplates.length];
    }

    if (!selectedTemplate) return null;

    return {
      title: user ? this.hydrateVariables(selectedTemplate.title, user) : selectedTemplate.title,
      body: user ? this.hydrateVariables(selectedTemplate.body, user) : selectedTemplate.body,
      image: selectedTemplate.imageUrl || null,
      imageUrl: selectedTemplate.imageUrl || null,
      actionRoute: selectedTemplate.actionRoute || campaign.targetRoute || "/dashboard",
      templateId: selectedTemplate._id
    };
  }

  // Process items in parallel batches of 50 to avoid network congestion
  async processInBatches(items, batchSize, iteratorFn) {
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      await Promise.all(chunk.map(item => iteratorFn(item).catch(err => console.error("[Segment Batch Error]:", err.message))));
    }
  }

  /**
   * Get total or daily-filtered population for a specific segment
   */
  async getSegmentPopulation(segmentKey, onlyUnsentToday = false) {
    const segment = segmentKey.toUpperCase();
    const now = new Date();
    const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const startOfToday = getStartOfTodayIST();

    const validFcmTokenQuery = {
      isDeleted: { $ne: true },
      fcmToken: { $exists: true, $nin: [null, ""] }
    };

    switch (segment) {
      case "A": {
        const query = {
          ...validFcmTokenQuery,
          role: "user",
          kycStatus: { $in: ["pending", "not_started"] },
          isKycComplete: { $ne: true },
          $and: [
            { $or: [{ shopImage: { $exists: false } }, { shopImage: null }, { shopImage: "" }] },
            { $or: [{ licenceImage: { $exists: false } }, { licenceImage: null }, { licenceImage: "" }] },
            { $or: [{ gstNumber: { $exists: false } }, { gstNumber: null }, { gstNumber: "" }] },
            {
              $or: [
                { kycReminderCount: { $exists: false } },
                { kycReminderCount: { $lt: 5 } }
              ]
            }
          ]
        };
        if (onlyUnsentToday) {
          query.$and.push({
            $or: [
              { lastKycReminderSentAt: { $exists: false } },
              { lastKycReminderSentAt: null },
              { lastKycReminderSentAt: { $lt: startOfToday } }
            ]
          });
        }
        return await User.find(query);
      }

      case "B": {
        const query = {
          ...validFcmTokenQuery,
          role: "user",
          kycStatus: { $in: ["pending", "rejected"] },
          isKycComplete: { $ne: true },
          $and: [
            {
              $or: [
                { shopImage: { $nin: [null, ""] } },
                { licenceImage: { $nin: [null, ""] } },
                { gstNumber: { $nin: [null, ""] } }
              ]
            }
          ]
        };
        if (onlyUnsentToday) {
          query.$and.push({
            $or: [
              { lastKycReminderSentAt: { $exists: false } },
              { lastKycReminderSentAt: null },
              { lastKycReminderSentAt: { $lt: startOfToday } }
            ]
          });
        }
        return await User.find(query);
      }

      case "C": {
        const query = {
          ...validFcmTokenQuery,
          role: "user",
          kycStatus: { $in: ["submitted", "processing"] }
        };
        if (onlyUnsentToday) {
          query.$or = [
            { lastKycReminderSentAt: { $exists: false } },
            { lastKycReminderSentAt: null },
            { lastKycReminderSentAt: { $lt: startOfToday } }
          ];
        }
        return await User.find(query);
      }

      case "D": {
        const usersWithOrders = await Order.distinct("user", { orderStatus: { $ne: "Cancelled" } });
        const query = {
          ...validFcmTokenQuery,
          _id: { $nin: usersWithOrders },
          kycStatus: "verified"
        };
        if (onlyUnsentToday) {
          query.$or = [
            { lastFirstOrderSentAt: { $exists: false } },
            { lastFirstOrderSentAt: null },
            { lastFirstOrderSentAt: { $lt: startOfToday } }
          ];
        }
        return await User.find(query);
      }

      case "E": {
        const cartQuery = {
          items: { $exists: true, $not: { $size: 0 } },
          updatedAt: { $lt: thirtyMinsAgo, $gt: sevenDaysAgo }
        };
        if (onlyUnsentToday) {
          cartQuery.$or = [{ reminderCount: { $exists: false } }, { reminderCount: { $lt: 2 } }];
          cartQuery.$and = [
            {
              $or: [
                { lastReminderSentAt: { $exists: false } },
                { lastReminderSentAt: null },
                { lastReminderSentAt: { $lt: threeHoursAgo } }
              ]
            }
          ];
        }
        const abandonedCarts = await Cart.find(cartQuery).populate("user");
        const userMap = new Map();
        for (const cart of abandonedCarts) {
          if (cart.user && cart.user.fcmToken && !userMap.has(cart.user._id.toString())) {
            cart.user._cartId = cart._id;
            userMap.set(cart.user._id.toString(), cart.user);
          }
        }
        return Array.from(userMap.values());
      }

      case "F": {
        const orderQuery = {
          paymentStatus: "Pending",
          orderStatus: { $nin: ["Cancelled", "Delivered"] },
          createdAt: { $lt: thirtyMinsAgo, $gt: fortyEightHoursAgo }
        };
        if (onlyUnsentToday) {
          orderQuery.$or = [{ reminderCount: { $exists: false } }, { reminderCount: { $lt: 2 } }];
          orderQuery.$and = [
            {
              $or: [
                { lastReminderSentAt: { $exists: false } },
                { lastReminderSentAt: null },
                { lastReminderSentAt: { $lt: threeHoursAgo } }
              ]
            }
          ];
        }
        const pendingOrders = await Order.find(orderQuery).populate("user");

        const sessionQuery = {
          status: "Pending",
          orderCreated: { $ne: true },
          createdAt: { $lt: thirtyMinsAgo, $gt: fortyEightHoursAgo }
        };
        if (onlyUnsentToday) {
          sessionQuery.$or = [{ reminderCount: { $exists: false } }, { reminderCount: { $lt: 2 } }];
          sessionQuery.$and = [
            {
              $or: [
                { lastReminderSentAt: { $exists: false } },
                { lastReminderSentAt: null },
                { lastReminderSentAt: { $lt: threeHoursAgo } }
              ]
            }
          ];
        }
        const pendingSessions = await CheckoutSession.find(sessionQuery).populate("user");

        const userMap = new Map();
        for (const o of pendingOrders) {
          if (o.user && o.user.fcmToken) {
            o.user._orderId = o._id;
            userMap.set(o.user._id.toString(), o.user);
          }
        }
        for (const s of pendingSessions) {
          if (s.user && s.user.fcmToken && !userMap.has(s.user._id.toString())) {
            s.user._sessionId = s._id;
            userMap.set(s.user._id.toString(), s.user);
          }
        }
        return Array.from(userMap.values());
      }

      case "G": {
        const onceUserStats = await Order.aggregate([
          { $match: { orderStatus: { $ne: "Cancelled" } } },
          { $group: { _id: "$user", count: { $sum: 1 }, lastOrderDate: { $max: "$createdAt" } } },
          { $match: { count: 1, lastOrderDate: { $lte: sevenDaysAgo } } }
        ]);
        const onceUserIds = onceUserStats.map(r => r._id);
        const query = {
          ...validFcmTokenQuery,
          _id: { $in: onceUserIds }
        };
        if (onlyUnsentToday) {
          query.$or = [
            { lastRepeatReminderSentAt: { $exists: false } },
            { lastRepeatReminderSentAt: null },
            { lastRepeatReminderSentAt: { $lt: sevenDaysAgo } }
          ];
        }
        return await User.find(query);
      }

      case "H": {
        const multiUserStats = await Order.aggregate([
          { $match: { orderStatus: { $ne: "Cancelled" } } },
          { $group: { _id: "$user", count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } }
        ]);
        const multiUserIds = multiUserStats.map(r => r._id);
        const query = {
          ...validFcmTokenQuery,
          _id: { $in: multiUserIds }
        };
        if (onlyUnsentToday) {
          query.$or = [
            { lastActiveBuyerSentAt: { $exists: false } },
            { lastActiveBuyerSentAt: null },
            { lastActiveBuyerSentAt: { $lt: twoDaysAgo } }
          ];
        }
        return await User.find(query);
      }

      case "I": {
        const highValueStats = await Order.aggregate([
          { $match: { orderStatus: { $ne: "Cancelled" } } },
          { $group: { _id: "$user", totalSpent: { $sum: "$totalAmount" }, maxSingleOrder: { $max: "$totalAmount" } } },
          { $match: { $or: [{ totalSpent: { $gte: 50000 } }, { maxSingleOrder: { $gte: 50000 } }] } }
        ]);
        const highValueIds = highValueStats.map(r => r._id);
        const query = {
          ...validFcmTokenQuery,
          _id: { $in: highValueIds }
        };
        if (onlyUnsentToday) {
          query.$or = [
            { lastVipSentAt: { $exists: false } },
            { lastVipSentAt: null },
            { lastVipSentAt: { $lt: sixDaysAgo } }
          ];
        }
        return await User.find(query);
      }

      case "J": {
        const recentActiveUsers = await Order.distinct("user", {
          orderStatus: { $ne: "Cancelled" },
          createdAt: { $gte: thirtyDaysAgo }
        });
        const query = {
          ...validFcmTokenQuery,
          _id: { $nin: recentActiveUsers },
          kycStatus: "verified",
          createdAt: { $lte: thirtyDaysAgo }
        };
        if (onlyUnsentToday) {
          query.$or = [
            { lastWinBackSentAt: { $exists: false } },
            { lastWinBackSentAt: null },
            { lastWinBackSentAt: { $lt: sixDaysAgo } }
          ];
        }
        return await User.find(query);
      }

      case "SEASONAL":
      case "TRUST":
      case "URGENCY": {
        return await User.find({
          ...validFcmTokenQuery
        });
      }

      default:
        return [];
    }
  }

  /**
   * Get eligible users for today's dispatch
   */
  async getEligibleUsersForSegment(segmentKey) {
    return await this.getSegmentPopulation(segmentKey, true);
  }

  /**
   * Get total population belonging to this segment
   */
  async getTotalUsersInSegment(segmentKey) {
    return await this.getSegmentPopulation(segmentKey, false);
  }

  /**
   * Dispatches notifications dynamically to all eligible users in a given segment
   */
  async sendToSegment(segmentKey, customTemplate = null) {
    const segment = segmentKey.toUpperCase();
    console.log(`[DynamicSegmentService] Processing Segment ${segment}...`);

    const campaign = await NotificationCampaign.findOne({ segmentKey: segment });
    if (campaign && !campaign.isEnabled && !customTemplate) {
      console.log(`[DynamicSegmentService] Segment ${segment} is currently disabled in panel. Skipping.`);
      return { count: 0, segment, disabled: true };
    }

    const users = await this.getEligibleUsersForSegment(segment);
    console.log(`[DynamicSegmentService] Segment ${segment}: Found ${users.length} eligible users with active FCM tokens.`);

    if (users.length === 0) {
      return { count: 0, segment };
    }

    const now = new Date();
    const isUtility = ["A", "B", "C"].includes(segment);
    let dispatchedCount = 0;

    await this.processInBatches(users, 50, async (user) => {
      try {
        const template = customTemplate || await this.getNotificationForSegment(segment, user);
        if (!template) return;

        const targetRoute = template.actionRoute || (isUtility ? "/kyc" : (["E", "F"].includes(segment) ? "/cart" : "/dashboard"));
        const personalizedTitle = interpolatePlaceholders(template.title, user);
        const personalizedBody = interpolatePlaceholders(template.body, user);

        const btn1Text = template.btn1Text || "⚡ Open Offer";
        const btn2Text = template.btn2Text || "📞 Call Support";

        if (isUtility) {
          await notificationService.sendUtilityNotification(user._id, personalizedTitle, personalizedBody, targetRoute, template.image || template.imageUrl, btn1Text, btn2Text);
          await User.findByIdAndUpdate(user._id, {
            $set: { lastKycReminderSentAt: now },
            $inc: { kycReminderCount: 1 }
          });
        } else {
          await notificationService.sendMarketingNotification(user._id, personalizedTitle, personalizedBody, targetRoute, template.image || template.imageUrl, btn1Text, btn2Text);
          
          const updateFields = {
            lastMarketingNotificationSentAt: now,
            lastMarketingSegment: segment
          };

          if (segment === "D") updateFields.lastFirstOrderSentAt = now;
          if (segment === "H") updateFields.lastActiveBuyerSentAt = now;
          if (segment === "I") updateFields.lastVipSentAt = now;
          if (segment === "G") updateFields.lastRepeatReminderSentAt = now;
          if (segment === "J") updateFields.lastWinBackSentAt = now;

          await User.findByIdAndUpdate(user._id, { $set: updateFields });
        }

        if (segment === "E" && user._cartId) {
          await Cart.findByIdAndUpdate(user._cartId, {
            $set: { lastReminderSentAt: now },
            $inc: { reminderCount: 1 }
          });
        }

        if (segment === "F") {
          if (user._sessionId) {
            await CheckoutSession.findByIdAndUpdate(user._sessionId, {
              $set: { lastReminderSentAt: now },
              $inc: { reminderCount: 1 }
            });
          }
          if (user._orderId) {
            await Order.findByIdAndUpdate(user._orderId, {
              $set: { lastReminderSentAt: now },
              $inc: { reminderCount: 1 }
            });
          }
        }

        dispatchedCount++;
      } catch (err) {
        console.error(`[DynamicSegmentService] Error dispatching to user ${user._id}:`, err.message);
      }
    });

    // Update Campaign Statistics in MongoDB
    if (campaign) {
      await NotificationCampaign.updateOne(
        { _id: campaign._id },
        {
          $set: {
            "stats.lastRunAt": now,
            "stats.lastDispatchedCount": dispatchedCount
          },
          $inc: {
            "stats.totalDispatches": 1,
            "stats.totalDelivered": dispatchedCount
          }
        }
      ).catch(() => {});
    }

    console.log(`[DynamicSegmentService] Segment ${segment}: Completed sending ${dispatchedCount} notifications.`);
    return { count: dispatchedCount, segment };
  }

  /**
   * Diagnostic summary of all campaigns, templates, schedules, and audience counts
   */
  async getSegmentStats() {
    await this.ensureSeedCampaigns();

    const startOfToday = getStartOfTodayIST();
    const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
    const usersWithToken = await User.countDocuments({ fcmToken: { $exists: true, $nin: [null, ""] }, isDeleted: { $ne: true } });

    const campaigns = await NotificationCampaign.find({}).sort({ segmentKey: 1 }).lean();
    const stats = [];

    for (const camp of campaigns) {
      const totalPopulation = await this.getTotalUsersInSegment(camp.segmentKey);
      const remainingToday = await this.getEligibleUsersForSegment(camp.segmentKey);
      const todayTemplate = await this.getNotificationForSegment(camp.segmentKey);

      const isDispatchedToday = Boolean(camp.stats?.lastRunAt && new Date(camp.stats.lastRunAt) >= startOfToday);
      const dispatchedTodayCount = isDispatchedToday ? (camp.stats?.lastDispatchedCount || 0) : 0;

      stats.push({
        ...camp,
        eligibleCount: totalPopulation.length,
        totalAudience: totalPopulation.length,
        remainingToday: remainingToday.length,
        isDispatchedToday,
        dispatchedTodayCount,
        todayTemplate
      });
    }

    return {
      totalUsers,
      usersWithToken,
      campaigns: stats
    };
  }
}

module.exports = new PushNotificationSegmentService();
