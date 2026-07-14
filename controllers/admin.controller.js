const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const CheckoutSession = require('../models/CheckoutSession');
const Event = require('../models/Event');
const AuditLog = require('../models/AuditLog');
const { redisClient } = require('../config/redis');

exports.getAuditLogs = async (req, res, next) => {
  try {
    const { adminEmail, limit = 50, before, role, search, action, targetModel, startDate, endDate } = req.query;
    const query = {};

    if (adminEmail) {
      query.adminEmail = adminEmail;
    }

    // Role filtering at DB level for "Sales" vs "Admin" tabs
    if (role) {
      // Find all users with this role first
      const User = require('../models/User');
      const usersWithRole = await User.find({ role: role.toLowerCase() }).select('_id');
      const userIds = usersWithRole.map(u => u._id);
      query.adminId = { $in: userIds };
    }

    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    if (startDate || endDate) {
      query.timestamp = query.timestamp || {};
      if (startDate) {
        query.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        query.timestamp.$lte = new Date(endDate);
      }
    }

    if (action && action !== 'All') {
      const act = action.toLowerCase();
      if (act === 'create') {
        query.action = { $regex: /create|add/i };
      } else if (act === 'update') {
        query.action = { $regex: /update|edit/i };
      } else if (act === 'delete') {
        query.action = { $regex: /delete|remove/i };
      } else if (act === 'security') {
        query.action = { $regex: /login|security|auth/i };
      }
    }

    if (targetModel && targetModel !== 'All') {
      const mod = targetModel.toLowerCase();
      if (mod === 'kyc') {
        query.targetModel = 'User';
        query.action = { $regex: /kyc/i };
      } else if (mod === 'user') {
        query.targetModel = 'User';
      } else if (mod === 'order') {
        query.targetModel = 'Order';
      } else if (mod === 'product') {
        query.targetModel = 'Product';
      }
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { adminEmail: searchRegex },
        { action: searchRegex },
        { targetModel: searchRegex }
      ];
    }

    const logs = await AuditLog.find(query)
      .populate('adminId', 'role email')
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    const totalCount = await AuditLog.countDocuments(query);

    // Flatten role into the log object for easier frontend consumption
    const flattenedLogs = logs.map(log => {
      const logObj = log.toObject();
      // Ensure we safely extract the role from the populated adminId object
      if (log.adminId && typeof log.adminId === 'object') {
        logObj.adminRole = log.adminId.role;
      } else {
        logObj.adminRole = null;
      }
      return logObj;
    });

    const nextCursor = logs.length === parseInt(limit) ? logs[logs.length - 1].timestamp : null;

    res.json({
      success: true,
      data: flattenedLogs,
      totalCount,
      nextCursor
    });
  } catch (error) {
    next(error);
  }
};

exports.getDashboardAnalytics = async (req, res, next) => {
  try {
    const { period = 'Today', startDate: customStart, endDate: customEnd } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date(now);
    let isTotal = false;

    if (customStart && customEnd) {
      startDate = new Date(customStart);
      endDate = new Date(customEnd);
      // Ensure endDate covers the full day
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'Today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '1 Week') {
      startDate.setDate(now.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'Last 1 Month' || period === 'This Month') {
      startDate.setMonth(now.getMonth() - 1);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'Last 3 Months') {
      startDate.setMonth(now.getMonth() - 3);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'Total' || period === 'All Time') {
      isTotal = true;
    } else {
      startDate.setHours(0, 0, 0, 0); // Default Today
    }

    const dateQuery = isTotal ? {} : { placedAt: { $gte: startDate, $lte: endDate } };

    // 1. User/Dealer counts
    const totalUsers = await User.countDocuments({ role: 'user' });
    const verifiedUsers = await User.countDocuments({ role: 'user', kycStatus: 'verified' });
    const pendingKyc = await User.countDocuments({ role: 'user', kycStatus: { $in: ['processing', 'submitted'] }, isProfileComplete: true });

    // New Leads Correction: Consistent filtering across all periods
    // We count users with role 'user' who are not verified yet (prospects)
    const leadQuery = {
      role: 'user',
      kycStatus: { $ne: 'verified' },
      ...dateQuery
    };
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
