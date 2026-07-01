const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const CheckoutSession = require('../models/CheckoutSession');
const Event = require('../models/Event');
const { redisClient } = require('../config/redis');

exports.getDashboardAnalytics = async (req, res, next) => {
  try {
    const { period = 'Today' } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    let isTotal = false;

    if (period === 'Today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '1 Week') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'Last 1 Month' || period === 'This Month') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (period === 'Last 3 Months') {
      startDate.setMonth(now.getMonth() - 3);
    } else if (period === 'Total' || period === 'All Time') {
      isTotal = true;
    } else {
      startDate.setHours(0, 0, 0, 0); // Default Today
    }

    const dateQuery = isTotal ? {} : { createdAt: { $gte: startDate } };

    // 1. User/Dealer counts
    const totalUsers = await User.countDocuments({ role: 'user' });
    const verifiedUsers = await User.countDocuments({ role: 'user', kycStatus: 'verified' });
    const pendingKyc = await User.countDocuments({ role: 'user', kycStatus: { $in: ['pending', 'submitted'] }, isProfileComplete: true });

    // New Leads Correction:
    // If Total: show users who are not verified yet (prospects)
    // If Period: show users created in that period
    const leadQuery = isTotal
      ? { role: 'user', kycStatus: { $ne: 'verified' } }
      : { role: 'user', ...dateQuery };
    const newLeads = await User.countDocuments(leadQuery);

    // 2. Order metrics
    const totalOrders = await Order.countDocuments();
    const periodOrders = await Order.countDocuments(dateQuery);
    const pendingOrders = await Order.countDocuments({ orderStatus: 'Processing' });
    
    // Optimized Revenue calculations using Aggregation
    const totalRevenueResult = await Order.aggregate([
      { $match: { orderStatus: { $ne: 'Cancelled' } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const totalRevenue = totalRevenueResult.length > 0 ? totalRevenueResult[0].total : 0;

    const periodRevenueResult = await Order.aggregate([
      { $match: { ...dateQuery, orderStatus: { $ne: 'Cancelled' } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    const periodRevenue = periodRevenueResult.length > 0 ? periodRevenueResult[0].total : 0;

    // 3. Checkout Sessions (Abandoned Checkouts logic)
    // Sessions that are Pending and haven't created an order yet.
    // We consider them abandoned if they are older than 15 mins.
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const abandonedQuery = isTotal
      ? { status: 'Pending', orderCreated: { $ne: true }, createdAt: { $lt: fifteenMinsAgo } }
      : { status: 'Pending', orderCreated: { $ne: true }, createdAt: { $gte: startDate, $lt: fifteenMinsAgo } };

    const abandonedCheckouts = await CheckoutSession.countDocuments(abandonedQuery);

    const recoveredOrders = await CheckoutSession.countDocuments({
      orderCreated: true,
      ...dateQuery
    });

    // 3b. Enhanced Abandoned Checkout logic from Events
    // Calculate abandoned checkouts based on event sessions (Started but not Completed)
    const eventDateQuery = isTotal ? {} : { timestamp: { $gte: startDate } };
    const abandonedEventsStats = await Event.aggregate([
      { $match: { ...eventDateQuery, eventType: { $in: ['checkout_started', 'payment_success'] } } },
      { $group: {
          _id: "$sessionId",
          hasStarted: { $max: { $cond: [{ $eq: ["$eventType", "checkout_started"] }, 1, 0] } },
          hasCompleted: { $max: { $cond: [{ $eq: ["$eventType", "payment_success"] }, 1, 0] } }
      } },
      { $match: { hasStarted: 1, hasCompleted: 0 } },
      { $count: "abandonedCount" }
    ]);
    const abandonedCheckoutsFromEvents = abandonedEventsStats.length > 0 ? abandonedEventsStats[0].abandonedCount : 0;

    // 4. Product metrics
    const totalProducts = await Product.countDocuments();

    // 5. Events - Cached in Redis for Today
    let eventsCount;
    const todayStr = now.toISOString().split('T')[0];
    if (period === 'Today' && redisClient.isOpen) {
      try {
        const cachedCount = await redisClient.get(`stats:events:count:daily:${todayStr}`);
        if (cachedCount !== null) {
          eventsCount = parseInt(cachedCount) || 0;
        }
      } catch (_) {}
    }
    if (eventsCount === undefined) {
      eventsCount = await Event.countDocuments(dateQuery);
      if (period === 'Today' && redisClient.isOpen) {
        try {
          await redisClient.set(`stats:events:count:daily:${todayStr}`, eventsCount, { EX: 259200 }); // 3 days
        } catch (_) {}
      }
    }

    res.json({
      success: true,
      analytics: {
        users: {
          total: totalUsers,
          verified: verifiedUsers,
          pendingKyc: pendingKyc,
          newLeads: newLeads
        },
        orders: {
          total: totalOrders,
          periodTotal: periodOrders,
          pending: pendingOrders,
          totalRevenue: totalRevenue,
          periodRevenue: periodRevenue
        },
        checkouts: {
          abandoned: abandonedCheckouts,
          recovered: recoveredOrders,
          abandonedFromEvents: abandonedCheckoutsFromEvents
        },
        products: {
          total: totalProducts
        },
        events: {
          periodTotal: eventsCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
