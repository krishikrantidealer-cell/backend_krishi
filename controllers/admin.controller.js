const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const CheckoutSession = require('../models/CheckoutSession');
const Event = require('../models/Event');
const AuditLog = require('../models/AuditLog');
const { redisClient } = require('../config/redis');

exports.getAuditLogs = async (req, res, next) => {
  try {
    const { adminEmail, limit = 50, before, role, search, action, targetModel, startDate, endDate, targetId, sortOrder } = req.query;
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
      const matchedUsers = await User.find({
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { phoneNumber: searchRegex },
          { shopName: searchRegex }
        ]
      }).select('_id');
      const matchedUserIds = matchedUsers.map(u => u._id);

      query.$or = [
        { adminEmail: searchRegex },
        { action: searchRegex },
        { targetModel: searchRegex },
        { adminId: { $in: matchedUserIds } },
        { targetId: { $in: matchedUserIds } },
        { 'changes.before.phoneNumber': searchRegex },
        { 'changes.after.phoneNumber': searchRegex },
        { 'changes.before.phone': searchRegex },
        { 'changes.after.phone': searchRegex },
        { 'changes.before.firstName': searchRegex },
        { 'changes.after.firstName': searchRegex },
        { 'changes.before.lastName': searchRegex },
        { 'changes.after.lastName': searchRegex },
        { 'changes.before.email': searchRegex },
        { 'changes.after.email': searchRegex },
        { 'changes.before.shopName': searchRegex },
        { 'changes.after.shopName': searchRegex }
      ];
    }

    // Filter by specific target user (for trash user activity timeline)
    if (targetId) {
      const mongoose = require('mongoose');
      query.targetId = mongoose.Types.ObjectId.isValid(targetId)
        ? new mongoose.Types.ObjectId(targetId)
        : targetId;
    }

    const sortDir = sortOrder === 'asc' ? 1 : -1;

    const logs = await AuditLog.find(query)
      .populate('adminId', 'role email firstName lastName')
      .sort({ timestamp: sortDir })
      .limit(parseInt(limit));

    const totalCount = await AuditLog.countDocuments(query);

    // Collect all assignedAgent IDs from changes to resolve in bulk
    const agentIdSet = new Set();
    for (const log of logs) {
      const assignedAgentAfter = log.changes?.after?.assignedAgent;
      if (assignedAgentAfter) agentIdSet.add(assignedAgentAfter.toString());
      const assignedAgentBefore = log.changes?.before?.assignedAgent;
      if (assignedAgentBefore) agentIdSet.add(assignedAgentBefore.toString());
    }

    // Bulk resolve agent IDs → name map
    let agentNameMap = {};
    if (agentIdSet.size > 0) {
      const mongoose = require('mongoose');
      const agentIds = [...agentIdSet].filter(id => mongoose.Types.ObjectId.isValid(id));
      const agents = await User.find({ _id: { $in: agentIds } }).select('_id firstName lastName email');
      for (const agent of agents) {
        const name = `${agent.firstName || ''} ${agent.lastName || ''}`.trim();
        agentNameMap[agent._id.toString()] = name || agent.email || 'Unknown Agent';
      }
    }

    // Collect all targetId where targetModel === 'User' to populate target user details
    const targetUserIdSet = new Set();
    for (const log of logs) {
      if (log.targetModel === 'User' && log.targetId) {
        targetUserIdSet.add(log.targetId.toString());
      }
    }

    // Bulk resolve targetUser IDs → user info map
    let targetUserMap = {};
    if (targetUserIdSet.size > 0) {
      const mongoose = require('mongoose');
      const targetUserIds = [...targetUserIdSet].filter(id => mongoose.Types.ObjectId.isValid(id));
      const users = await User.find({ _id: { $in: targetUserIds } }).select('_id firstName lastName email phoneNumber shopName');
      for (const u of users) {
        targetUserMap[u._id.toString()] = {
          firstName: u.firstName,
          lastName: u.lastName,
          email: u.email,
          phoneNumber: u.phoneNumber,
          shopName: u.shopName
        };
      }
    }

    // Flatten log object for frontend consumption
    const flattenedLogs = logs.map(log => {
      const logObj = log.toObject();

      // Populate admin role + full name
      if (log.adminId && typeof log.adminId === 'object') {
        logObj.adminRole = log.adminId.role;
        const adminName = `${log.adminId.firstName || ''} ${log.adminId.lastName || ''}`.trim();
        logObj.adminName = adminName || log.adminId.email || log.adminEmail || 'Unknown';
      } else {
        logObj.adminRole = null;
        logObj.adminName = logObj.adminEmail || 'System';
      }

      // Resolve assignedAgent ID to name in changes
      if (logObj.changes?.after?.assignedAgent) {
        const agentId = logObj.changes.after.assignedAgent.toString();
        logObj.changes.after.assignedAgentName = agentNameMap[agentId] || 'Unknown Agent';
      }
      if (logObj.changes?.before?.assignedAgent) {
        const agentId = logObj.changes.before.assignedAgent.toString();
        logObj.changes.before.assignedAgentName = agentNameMap[agentId] || 'Unknown Agent';
      }

      // Inject target user info into changes to resolve user identification issues on frontend
      if (logObj.targetModel === 'User' && logObj.targetId) {
        const targetUser = targetUserMap[logObj.targetId.toString()];
        if (targetUser) {
          if (!logObj.changes) logObj.changes = {};
          if (!logObj.changes.after) logObj.changes.after = {};
          if (logObj.changes.after.firstName === undefined) logObj.changes.after.firstName = targetUser.firstName;
          if (logObj.changes.after.lastName === undefined) logObj.changes.after.lastName = targetUser.lastName;
          if (logObj.changes.after.email === undefined) logObj.changes.after.email = targetUser.email;
          if (logObj.changes.after.phoneNumber === undefined) logObj.changes.after.phoneNumber = targetUser.phoneNumber;
          if (logObj.changes.after.shopName === undefined) logObj.changes.after.shopName = targetUser.shopName;
        }
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

const Estimate = require('../models/Estimate');

// Get all estimates
exports.getAllEstimates = async (req, res, next) => {
  try {
    const estimates = await Estimate.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      estimates
    });
  } catch (error) {
    next(error);
  }
};

// Create new estimate
exports.createEstimate = async (req, res, next) => {
  try {
    let estimateNo = req.body.estimateNo;
    if (!estimateNo) {
      const now = new Date();
      const year = now.getFullYear() % 100;
      const nextYear = (now.getFullYear() + 1) % 100;
      const rand = Math.floor(1000 + Math.random() * 9000).toString();
      estimateNo = `EBS/${year}-${nextYear}/EST/${rand}`;
    }

    // Check uniqueness
    let existing = await Estimate.findOne({ estimateNo });
    while (existing) {
      const now = new Date();
      const year = now.getFullYear() % 100;
      const nextYear = (now.getFullYear() + 1) % 100;
      const rand = Math.floor(1000 + Math.random() * 9000).toString();
      estimateNo = `EBS/${year}-${nextYear}/EST/${rand}`;
      existing = await Estimate.findOne({ estimateNo });
    }

    const estimate = await Estimate.create({
      ...req.body,
      estimateNo
    });

    res.status(201).json({
      success: true,
      estimate
    });
  } catch (error) {
    next(error);
  }
};

// Update estimate
exports.updateEstimate = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const estimate = await Estimate.findById(id);
    if (!estimate) {
      return res.status(404).json({
        success: false,
        message: 'Estimate not found'
      });
    }

    const updateData = { ...req.body };
    delete updateData.estimateNo;

    const updatedEstimate = await Estimate.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      estimate: updatedEstimate
    });
  } catch (error) {
    next(error);
  }
};

// Delete estimate
exports.deleteEstimate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const estimate = await Estimate.findByIdAndDelete(id);
    if (!estimate) {
      return res.status(404).json({
        success: false,
        message: 'Estimate not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Estimate deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
