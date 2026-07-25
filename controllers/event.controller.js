const Event = require('../models/Event');
const mongoose = require('mongoose');
const User = require('../models/User');
const { redisClient } = require('../config/redis');
const { sendToAll } = require('../services/websocket.service');

/**
 * Handle individual event ingestion (legacy support)
 */
exports.createEvent = async (req, res, next) => {
  try {
    const { user, eventType, device, details, payload, timestamp, role } = req.body;

    const event = await Event.create({
      user: user || 'anonymous',
      eventType: eventType || 'unknown',
      device,
      details,
      payload,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      role
    });

    // Update Real-time Presence in Redis
    if (redisClient.isOpen && user) {
      const presenceKey = `presence:${user}`;
      const presenceData = {
        lastSeen: new Date().toISOString(),
        currentScreen: payload?.screen || 'Active',
        action: eventType,
        device: device || 'Unknown'
      };
      await redisClient.hSet(presenceKey, presenceData);
      await redisClient.expire(presenceKey, 120);

      // Notify Admins via WebSocket
      sendToAll({ type: 'PRESENCE_UPDATE', data: { user, ...presenceData } });
    }

    // Increment Redis daily events count
    if (redisClient.isOpen) {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        await redisClient.incr(`stats:events:count:daily:${todayStr}`);
        await redisClient.expire(`stats:events:count:daily:${todayStr}`, 259200); // 3 days
      } catch (_) {}
    }

    res.status(201).json({ success: true, data: event });
  } catch (error) {
    next(error);
  }
};

/**
 * High-Speed Heartbeat for Real-time Presence
 * SKIPS MongoDB - ONLY updates Redis for maximum speed.
 */
exports.handleHeartbeat = async (req, res, next) => {
  try {
    const { user, currentScreen, lastAction, device } = req.body;

    if (redisClient.isOpen && user) {
      const presenceKey = `presence:${user}`;

      // Fetch user info for enrichment
      let userName = 'Unknown';
      let userPhone = 'N/A';
      try {
        const userData = await User.findOne({
          $or: [{ email: user }, { phoneNumber: user }, { _id: mongoose.Types.ObjectId.isValid(user) ? user : null }]
        }).select('firstName lastName shopName phoneNumber role');

        if (userData) {
          userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.shopName;
          userPhone = userData.phoneNumber;
          userRole = userData.role || 'user';
        }
      } catch (_) {}

      const presenceData = {
        lastSeen: new Date().toISOString(),
        currentScreen: currentScreen || 'Active',
        action: lastAction || 'Browsing',
        device: device || 'Unknown',
        userName,
        userPhone,
        role: userRole
      };

      await redisClient.hSet(presenceKey, presenceData);
      await redisClient.expire(presenceKey, 120); // Longer expiry to survive idle heartbeat (60s)
      await redisClient.zAdd('presence_active_zset', { score: Date.now(), value: String(user) });

      // Gold Standard: Push update to Admin Dashboard via WebSocket
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], {
        type: 'PRESENCE_UPDATE',
        data: { user, ...presenceData }
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(200).json({ success: true });
  }
};

/**
 * Gold Standard: Batch Ingestion
 */
exports.ingestBatch = async (req, res, next) => {
  try {
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid batch format' });
    }

    // Map to model with deduplication support
    const preparedEvents = events.map(e => ({
      user: e.user || 'anonymous',
      eventId: e.eventId,
      sessionId: e.sessionId,
      schemaVersion: e.schemaVersion || '1.0.0',
      eventType: e.event || e.eventType || 'unknown',
      device: e.device || e.platform,
      details: e.details || '',
      payload: e.properties || e.payload || {},
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
      role: e.role || 'user'
    }));

    try {
      // ordered: false allows continuing ingestion even if some eventIds are duplicates
      await Event.insertMany(preparedEvents, { ordered: false });
    } catch (insertError) {
      // Ignore duplicate key errors (code 11000), log others
      if (insertError.code !== 11000) {
        console.error('[Analytics] Partial Ingestion Error:', insertError.message);
      }
    }

    if (redisClient.isOpen) {
      const lastEvent = events[events.length - 1];
      const user = lastEvent.user;
      const presenceKey = `presence:${user}`;

      // Fetch user info for enrichment
      let userName = 'Unknown';
      let userPhone = 'N/A';
      try {
        const userData = await User.findOne({
          $or: [{ email: user }, { phoneNumber: user }, { _id: mongoose.Types.ObjectId.isValid(user) ? user : null }]
        }).select('firstName lastName shopName phoneNumber');

        if (userData) {
          userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.shopName;
          userPhone = userData.phoneNumber;
        }
      } catch (_) {}

      const presenceData = {
        lastSeen: new Date().toISOString(),
        currentScreen: String(lastEvent.properties?.screen || lastEvent.payload?.screen || 'Active'),
        action: String(lastEvent.event || lastEvent.eventType || 'unknown'),
        device: String(lastEvent.device || lastEvent.platform || 'Unknown'),
        sessionId: String(lastEvent.sessionId || 'unknown'),
        userName: String(userName || 'Unknown'),
        userPhone: String(userPhone || 'N/A')
      };

      await redisClient.hSet(presenceKey, presenceData);
      await redisClient.expire(presenceKey, 120);
      await redisClient.zAdd('presence_active_zset', { score: Date.now(), value: String(user) });

      // Notify Admins via WebSocket
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], {
        type: 'PRESENCE_UPDATE',
        data: { user, ...presenceData }
      });
    }

    // Increment Redis daily events count in batch
    if (redisClient.isOpen && preparedEvents.length > 0) {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        await redisClient.incrBy(`stats:events:count:daily:${todayStr}`, preparedEvents.length);
        await redisClient.expire(`stats:events:count:daily:${todayStr}`, 259200); // 3 days
      } catch (_) {}
    }

    res.status(201).json({ success: true, count: events.length });
  } catch (error) {
    console.error('[Analytics] Critical Batch Ingestion Error:', error);
    res.status(500).json({ success: false, message: 'Ingestion failed' });
  }
};

/**
 * Fetch historical events for Admin Panel
 * Joins User collection to show Name and Phone instead of just ID/Email
 */
exports.getEvents = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 300;
    const { user, before, filter, actorOnly } = req.query;

    let query = {};
    let resolvedIdentifiers = [];

    // 1. Resolve Global User Search if provided
    if (user) {
      resolvedIdentifiers = [user, user.toLowerCase()];
      try {
        const matchedUsers = await User.find({
          $or: [
            { email: new RegExp(user, 'i') },
            { phoneNumber: new RegExp(user, 'i') },
            { firstName: new RegExp(user, 'i') },
            { lastName: new RegExp(user, 'i') },
            { shopName: new RegExp(user, 'i') }
          ]
        }).select('_id email phoneNumber').lean();
        
        matchedUsers.forEach(u => {
          if (u.email) resolvedIdentifiers.push(u.email, u.email.toLowerCase());
          if (u.phoneNumber) resolvedIdentifiers.push(u.phoneNumber);
          if (u._id) resolvedIdentifiers.push(u._id.toString());
        });
      } catch (_) {}

      resolvedIdentifiers = [...new Set(resolvedIdentifiers)];
      if (actorOnly === 'true') {
        query.user = { $in: resolvedIdentifiers };
      } else {
        query.$or = [
          { user: { $in: resolvedIdentifiers } },
          ...resolvedIdentifiers.map(id => ({ "payload.dealerId": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.dealerEmail": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.dealerPhone": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.userId": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.userEmail": id }))
        ];
      }
    }

    // Enforce assigned customer filtering for Sales Representatives
    const assignedUserIds = await getSalesAssignedUserIds(req);
    if (assignedUserIds) {
      if (assignedUserIds.size === 0) {
        return res.json({ success: true, events: [], nextCursor: null });
      }
      const assignedArray = Array.from(assignedUserIds);
      if (query.user && query.user.$in) {
        query.user.$in = query.user.$in.filter(u => assignedUserIds.has(u.toString().toLowerCase()));
        if (query.user.$in.length === 0) {
          return res.json({ success: true, events: [], nextCursor: null });
        }
      } else if (!query.user) {
        query.user = { $in: assignedArray };
      }
    }

    // 2. Handle Pagination
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    // 3. Handle Global Filters (Abandoned Cart, Failed Payment, etc.)
    if (filter && filter !== 'All') {
      if (filter === 'High Priority' || filter === 'Abandoned Carts' || filter === 'Failed Payments' || filter === 'Live Users') {
        if (filter === 'Live Users') {
          let activeUsers = [];
          if (redisClient && redisClient.isOpen) {
            const cutoff = Date.now() - 300000;
            try {
              activeUsers = await redisClient.zRangeByScore('presence_active_zset', cutoff, '+inf');
            } catch (_) {}
          }
          if (activeUsers.length === 0) {
            const fiveMinsAgo = new Date(Date.now() - 300000);
            const recentEvents = await Event.distinct('user', { timestamp: { $gte: fiveMinsAgo } });
            activeUsers = recentEvents.filter(u => u && u !== 'guest' && u !== 'anonymous');
          }
          if (activeUsers.length === 0) {
            return res.json({ success: true, data: [], nextCursor: null });
          }
          query.user = { $in: activeUsers };
        } else {
          const fourteenDaysAgo = new Date();
          fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

          const aggregationMatch = { timestamp: { $gte: fourteenDaysAgo } };
          if (query.$or) aggregationMatch.$or = query.$or;
          if (query.user) aggregationMatch.user = query.user;

          const userEventStates = await Event.aggregate([
            { $match: aggregationMatch },
            {
              $group: {
                _id: '$user',
                eventTypes: { $addToSet: '$eventType' }
              }
            }
          ]);

          const filteredUserIds = [];
          userEventStates.forEach(userState => {
            const types = new Set(userState.eventTypes);
            let match = false;
            const hasSuccess = types.has('payment_success') || types.has('order_placed') || types.has('order_completed');

            if (filter === 'High Priority') {
              match = (types.has('payment_failed') && !hasSuccess) ||
                     (types.has('checkout_started') && !hasSuccess) ||
                     (types.has('add_to_cart') && !hasSuccess);
            } else if (filter === 'Abandoned Carts') {
              match = (types.has('checkout_started') && !hasSuccess) ||
                     (types.has('add_to_cart') && !hasSuccess);
            } else if (filter === 'Failed Payments') {
              match = types.has('payment_failed') && !hasSuccess;
            }

            if (match && userState._id) {
              filteredUserIds.push(userState._id);
            }
          });

          if (filteredUserIds.length === 0) {
            return res.json({ success: true, data: [], nextCursor: null });
          }

          query.user = { $in: filteredUserIds };
        }
      } else {
        const fLower = filter.toLowerCase();
        if (fLower === 'add_to_cart' || fLower === 'cart_add') {
          query.eventType = { $in: ['add_to_cart', 'cart_add', 'cart_view'] };
        } else if (fLower === 'checkout_started' || fLower === 'checkout_init') {
          query.eventType = { $in: ['checkout_started', 'checkout_init', 'apply_coupon', 'payment_initiated'] };
        } else if (fLower === 'payment_success' || fLower === 'order_placed' || fLower === 'order_completed') {
          query.eventType = { $in: ['payment_success', 'order_placed', 'order_completed', 'order_created'] };
        } else if (fLower === 'product_search' || fLower === 'product_view') {
          query.eventType = { $in: ['product_search', 'product_view', 'category_view', 'page_view', 'search', 'login_success'] };
        } else {
          query.eventType = filter;
        }
      }
    }

    // 4. Fetch raw events
    const rawEvents = await Event.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    if (rawEvents.length === 0) {
      return res.json({ success: true, data: [], nextCursor: null });
    }

    // 5. Enrich with User Details
    const uniqueUsernames = [...new Set(rawEvents.map(e => e.user).filter(Boolean))];
    const userOrConditions = uniqueUsernames.map(u => {
      const cond = [{ email: u }, { phoneNumber: u }];
      if (mongoose.Types.ObjectId.isValid(u)) cond.push({ _id: new mongoose.Types.ObjectId(u) });
      return cond;
    }).flat();

    let usersList = [];
    if (userOrConditions.length > 0) {
      usersList = await User.find({ $or: userOrConditions })
        .select('firstName lastName phoneNumber shopName role email kycStatus userType')
        .lean();
    }

    const userMap = new Map();
    usersList.forEach(u => {
      if (u.email) userMap.set(u.email.toLowerCase(), u);
      if (u.phoneNumber) userMap.set(u.phoneNumber, u);
      if (u._id) userMap.set(u._id.toString(), u);
    });

    const enrichedEvents = rawEvents.map(event => {
      const uKey = event.user ? event.user.toString() : '';
      const matchedUser = userMap.get(uKey) || userMap.get(uKey.toLowerCase());
      return {
        ...event,
        userDetails: matchedUser ? {
          firstName: matchedUser.firstName,
          lastName: matchedUser.lastName,
          phoneNumber: matchedUser.phoneNumber,
          shopName: matchedUser.shopName,
          role: matchedUser.role,
          kycStatus: matchedUser.kycStatus,
          userType: matchedUser.userType
        } : null
      };
    });

    let nextCursor = null;
    if (enrichedEvents.length === limit && enrichedEvents.length > 0) {
      const lastEvent = enrichedEvents[enrichedEvents.length - 1];
      if (lastEvent.timestamp) {
        nextCursor = lastEvent.timestamp instanceof Date 
          ? lastEvent.timestamp.toISOString() 
          : new Date(lastEvent.timestamp).toISOString();
      }
    }

    res.json({ success: true, data: enrichedEvents, nextCursor });
  } catch (error) {
    next(error);
  }
};

/**
 * Real-time active users from Redis
 * Joins User collection for better display
 */
exports.getActiveUsers = async (req, res, next) => {
  try {
    if (!redisClient.isOpen) {
      return res.status(503).json({ success: false, message: 'Redis unavailable' });
    }

    const now = Date.now();
    const cutoff = now - 120000; // 2 minutes ago

    // 1. Prune expired entries from sorted set
    try {
      await redisClient.zRemRangeByScore('presence_active_zset', 0, cutoff);
    } catch (_) {}

    // 2. Fetch active users efficiently from Redis Sorted Set (fallback to keys scan if set is empty)
    let activeUsers = [];
    try {
      activeUsers = await redisClient.zRangeByScore('presence_active_zset', cutoff, '+inf');
    } catch (_) {}

    let keys = activeUsers.map(u => `presence:${u}`);
    if (keys.length === 0) {
      keys = await redisClient.keys('presence:*');
    }

    if (keys.length === 0) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const pipeline = redisClient.multi();
    keys.forEach(key => pipeline.hGetAll(key));
    const results = await pipeline.exec();

    const rawActiveUsers = keys.map((key, index) => ({
      user: key.replace('presence:', ''),
      ...(results[index] || {})
    })).filter(u => u.user && u.lastSeen);

    // Enrich with user names/numbers from DB
    const userIdsOrEmails = rawActiveUsers.map(u => u.user);
    const users = await User.find({
      $or: [
        { email: { $in: userIdsOrEmails } },
        { phoneNumber: { $in: userIdsOrEmails } },
        { _id: { $in: userIdsOrEmails.filter(id => mongoose.Types.ObjectId.isValid(id)) } }
      ]
    }).select('firstName lastName phoneNumber shopName email');

    const enrichedUsers = rawActiveUsers.map(raw => {
      const match = users.find(u =>
        u.email === raw.user ||
        u.phoneNumber === raw.user ||
        u._id.toString() === raw.user
      );
      return {
        ...raw,
        userName: match ? `${match.firstName || ''} ${match.lastName || ''}`.trim() || match.shopName : (raw.userName || 'Unknown'),
        userPhone: match ? match.phoneNumber : (raw.userPhone || 'N/A')
      };
    });

    res.json({ success: true, count: enrichedUsers.length, data: enrichedUsers });
  } catch (error) {
    next(error);
  }
};

async function getSalesAssignedUserData(req) {
  if (!req.user || req.user.role !== 'sales') return null;
  const agentIdStr = req.user._id ? req.user._id.toString() : '';
  const agentEmail = req.user.email ? req.user.email.toLowerCase() : '';
  if (!agentIdStr && !agentEmail) return null;

  const mongoose = require('mongoose');
  const User = require('../models/User');

  const orConditions = [];
  if (agentIdStr) {
    orConditions.push({ assignedAgentId: agentIdStr });
    orConditions.push({ assignedAgent: agentIdStr });
    if (mongoose.Types.ObjectId.isValid(agentIdStr)) {
      orConditions.push({ assignedAgent: new mongoose.Types.ObjectId(agentIdStr) });
    }
  }
  if (agentEmail) {
    orConditions.push({ assignedAgent: agentEmail });
    orConditions.push({ 'assignedAgent.email': agentEmail });
  }

  try {
    const assignedUsers = await User.find({ $or: orConditions }, { _id: 1, email: 1, phoneNumber: 1, phone: 1, firstName: 1, lastName: 1, shopName: 1 }).lean();
    const idSet = new Set();
    const objectIds = [];

    assignedUsers.forEach(u => {
      if (u._id) {
        idSet.add(u._id.toString().toLowerCase());
        objectIds.push(u._id);
      }
      if (u.email) idSet.add(u.email.toLowerCase());
      if (u.phoneNumber) idSet.add(u.phoneNumber.toLowerCase());
      if (u.phone) idSet.add(u.phone.toLowerCase());
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
      if (name) idSet.add(name);
      if (u.shopName) idSet.add(u.shopName.toLowerCase());
    });
    return { idSet, objectIds };
  } catch (err) {
    console.error('[getSalesAssignedUserData] Error:', err);
    return null;
  }
}

async function getSalesAssignedUserIds(req) {
  const data = await getSalesAssignedUserData(req);
  return data ? data.idSet : null;
}

/**
 * Funnel Analytics Aggregation
 */
exports.getFunnelData = async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'sales') {
      return res.status(403).json({ success: false, message: 'Conversion Funnel is reserved for Marketing & Admin roles.' });
    }
    const assignedUserIds = await getSalesAssignedUserIds(req);
    const { days = '30', startDate: reqStart, endDate: reqEnd } = req.query;
    let startDate = new Date(0);
    let endDate = null;

    if (reqStart && reqEnd) {
      startDate = new Date(reqStart);
      endDate = new Date(reqEnd);
      if (reqEnd.length <= 10) {
        endDate.setHours(23, 59, 59, 999);
      }
    } else if (days === '1' || days === 'Today') {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (days !== 'all' && days !== 'All Time') {
      const numDays = parseInt(days) || 30;
      startDate = new Date(Date.now() - numDays * 24 * 60 * 60 * 1000);
    }

    const funnelStages = [
      { step: '1. App Browse & Search', aliases: ['product_view', 'product_search', 'category_view', 'page_view', 'app_launch', 'login_success', 'search', 'kyc_verified', 'lead_created', 'user_registered', 'all'] },
      { step: '2. Add To Cart', aliases: ['add_to_cart', 'cart_add', 'cart_view'] },
      { step: '3. Checkout Started', aliases: ['checkout_started', 'checkout_init', 'apply_coupon', 'payment_initiated'] },
      { step: '4. Order Completed', aliases: ['order_placed', 'payment_success', 'order_completed', 'order_created'] }
    ];

    let matchCond = {};
    if (days !== 'all' && days !== 'All Time') {
      matchCond.timestamp = { $gte: startDate };
      if (endDate) {
        matchCond.timestamp.$lte = endDate;
      }
    }

    const aggregateResults = await Event.aggregate([
      { $match: matchCond },
      {
        $group: {
          _id: '$eventType',
          uniqueUsers: { $addToSet: '$user' },
          eventCount: { $sum: 1 }
        }
      }
    ]);

    // Also include User & Order collections for exact Step 1 and Step 4 numbers
    const Order = require('../models/Order');
    const User = require('../models/User');

    const orderUserSet = new Set();
    let orderTotalCount = 0;
    try {
      let orderQuery = {};
      if (days !== 'all' && days !== 'All Time') {
        orderQuery.createdAt = { $gte: startDate };
        if (endDate) {
          orderQuery.createdAt.$lte = endDate;
        }
      }
      const orders = await Order.find(orderQuery).select('user').lean();
      orders.forEach(o => {
        if (o.user) {
          const uStr = typeof o.user === 'object' ? (o.user._id || o.user).toString() : o.user.toString();
          orderUserSet.add(uStr);
        }
      });
      orderTotalCount = orders.length;
    } catch (_) {}

    const allRegisteredUsersSet = new Set();
    try {
      let userQuery = {};
      if (days !== 'all' && days !== 'All Time') {
        userQuery.createdAt = { $gte: startDate };
        if (endDate) {
          userQuery.createdAt.$lte = endDate;
        }
      }
      const regUsers = await User.find(userQuery).select('_id email phoneNumber').lean();
      regUsers.forEach(u => {
        if (u._id) allRegisteredUsersSet.add(u._id.toString());
      });
    } catch (_) {}

    const stageData = funnelStages.map((stage, idx) => {
      const userSet = new Set();
      let totalEvents = 0;

      aggregateResults.forEach(item => {
        const typeLower = (item._id || '').toLowerCase();
        if (stage.aliases.some(a => typeLower.includes(a))) {
          item.uniqueUsers.forEach(u => {
            if (u && u !== 'anonymous' && u !== 'guest' && u !== 'unknown') {
              const uStr = u.toString().toLowerCase();
              if (!assignedUserIds || assignedUserIds.has(uStr)) {
                userSet.add(u.toString());
              }
            }
          });
          totalEvents += item.eventCount;
        }
      });

      if (idx === 0) {
        allRegisteredUsersSet.forEach(u => {
          if (!assignedUserIds || assignedUserIds.has(u.toLowerCase())) {
            userSet.add(u);
          }
        });
        if (totalEvents < userSet.size) totalEvents = userSet.size;
      }

      if (idx === 3) {
        orderUserSet.forEach(u => {
          if (!assignedUserIds || assignedUserIds.has(u.toLowerCase())) {
            userSet.add(u);
          }
        });
        if (totalEvents < orderTotalCount) totalEvents = orderTotalCount;
      }

      // Ensure Step 1 is at least as large as any downstream step
      return {
        step: stage.step,
        userCount: userSet.size,
        eventCount: totalEvents
      };
    });

    // Ensure Step 1 userCount >= Step 2/3/4 userCounts
    const maxUsers = Math.max(...stageData.map(s => s.userCount), 0);
    if (stageData[0].userCount < maxUsers) {
      stageData[0].userCount = maxUsers;
      if (stageData[0].eventCount < maxUsers) stageData[0].eventCount = maxUsers;
    }

    const step1Users = stageData[0].userCount;

    const formatted = stageData.map((s, idx) => {
      const conversionRate = step1Users > 0
        ? Math.min(100.0, Number(((s.userCount / step1Users) * 100).toFixed(1)))
        : 0.0;
      return {
        stepName: s.step,
        userCount: s.userCount,
        eventCount: s.eventCount,
        conversionRate
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch global metrics summary (total high priority, failed payment, abandoned cart users)
 */
exports.getSummaryMetrics = async (req, res, next) => {
  try {
    const isSales = req.user && req.user.role === 'sales';
    const agentIdStr = req.user && req.user._id ? req.user._id.toString() : '';
    const agentEmail = req.user && req.user.email ? req.user.email.toLowerCase() : '';

    const cacheKey = isSales
      ? `stats:events:summary-metrics:sales:${agentIdStr || agentEmail}`
      : 'stats:events:summary-metrics:v2';
    
    // 1. Try to fetch from Redis Cache first
    if (redisClient && redisClient.isOpen) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached) });
        }
      } catch (err) {
        console.error('[SummaryMetrics] Redis error:', err);
      }
    }

    // If Sales, find all assigned users first
    let assignedUserIds = null;
    if (isSales && (agentIdStr || agentEmail)) {
      const orConditions = [];
      if (agentIdStr) {
        orConditions.push({ assignedAgent: agentIdStr });
        orConditions.push({ assignedAgentId: agentIdStr });
      }
      if (agentEmail) {
        orConditions.push({ assignedAgent: agentEmail });
        orConditions.push({ assignedAgentId: agentEmail });
      }
      if (mongoose.Types.ObjectId.isValid(agentIdStr)) {
        orConditions.push({ assignedAgent: new mongoose.Types.ObjectId(agentIdStr) });
      }

      if (orConditions.length > 0) {
        try {
          const assignedUsers = await User.find({ $or: orConditions }, { _id: 1, email: 1, phoneNumber: 1, phone: 1, firstName: 1, lastName: 1, shopName: 1 }).lean();
          assignedUserIds = new Set();
          assignedUsers.forEach(u => {
            if (u._id) assignedUserIds.add(u._id.toString().toLowerCase());
            if (u.email) assignedUserIds.add(u.email.toLowerCase());
            if (u.phoneNumber) assignedUserIds.add(u.phoneNumber.toLowerCase());
            if (u.phone) assignedUserIds.add(u.phone.toLowerCase());
            const name = `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();
            if (name) assignedUserIds.add(name);
            if (u.shopName) assignedUserIds.add(u.shopName.toLowerCase());
          });
        } catch (err) {
          console.error('[SummaryMetrics] Error fetching assigned users:', err);
        }
      }
    }

    // 2. Query MongoDB, limiting matching events to the last 14 days for optimal performance
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const userEventStates = await Event.aggregate([
      {
        $match: {
          timestamp: { $gte: fourteenDaysAgo }
        }
      },
      {
        $group: {
          _id: '$user',
          eventTypes: { $addToSet: '$eventType' }
        }
      }
    ]);

    let failedPaymentsCount = 0;
    let abandonedCheckoutsCount = 0;
    let abandonedCartsCount = 0;

    userEventStates.forEach(userState => {
      const types = new Set(userState.eventTypes);
      const userId = userState._id ? userState._id.toString().toLowerCase() : '';
      
      // Filter out admins/sales/guests
      if (userId.includes('admin') || userId.includes('sales') || userId === 'guest' || userId === '') {
        return;
      }

      if (assignedUserIds && !assignedUserIds.has(userId)) {
        return;
      }

      // Resolution Logic: If they eventually succeeded, they are no longer High Priority
      const hasSuccess = types.has('payment_success') || types.has('order_placed') || types.has('order_completed');

      if (types.has('payment_failed') && !hasSuccess) {
        failedPaymentsCount++;
      } else if (types.has('checkout_started') && !hasSuccess) {
        abandonedCheckoutsCount++;
      } else if (types.has('add_to_cart') && !types.has('checkout_started') && !hasSuccess) {
        abandonedCartsCount++;
      }
    });

    const totalAbandonedCarts = abandonedCartsCount + abandonedCheckoutsCount;
    const highPriorityCount = failedPaymentsCount + totalAbandonedCarts;

    const resultData = {
      highPriority: highPriorityCount,
      failedPayments: failedPaymentsCount,
      abandonedCarts: totalAbandonedCarts,
      abandonedCheckouts: abandonedCheckoutsCount
    };

    // 3. Save to Redis Cache (30 seconds expiry)
    if (redisClient && redisClient.isOpen) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(resultData), { EX: 30 });
      } catch (err) {
        console.error('[SummaryMetrics] Redis set error:', err);
      }
    }

    res.json({
      success: true,
      data: resultData
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Regional District & Crop Intelligence Analytics
 */
exports.getDistrictAnalytics = async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'sales') {
      return res.status(403).json({ success: false, message: 'Regional Heatmap is reserved for Marketing & Admin roles.' });
    }
    const Order = require('../models/Order');
    const User = require('../models/User');

    const { days = '30', startDate: reqStart, endDate: reqEnd } = req.query;
    let startDate = new Date(0);
    let endDate = null;

    if (reqStart && reqEnd) {
      startDate = new Date(reqStart);
      endDate = new Date(reqEnd);
      if (reqEnd.length <= 10) {
        endDate.setHours(23, 59, 59, 999);
      }
    } else if (days === '1' || days === 'Today') {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (days !== 'all' && days !== 'All Time') {
      const numDays = parseInt(days) || 30;
      startDate = new Date(Date.now() - numDays * 24 * 60 * 60 * 1000);
    }

    const salesData = await getSalesAssignedUserData(req);

    const orderMatch = { 'shippingAddress.cityTehsil': { $exists: true, $ne: '' } };
    const userMatch = { 'address.cityTehsil': { $exists: true, $ne: '' } };

    if (days !== 'all' && days !== 'All Time') {
      orderMatch.createdAt = { $gte: startDate };
      if (endDate) {
        orderMatch.createdAt.$lte = endDate;
      }
    }

    if (salesData) {
      if (salesData.objectIds.length === 0) {
        return res.json({ success: true, data: [] });
      }
      orderMatch.user = { $in: salesData.objectIds };
      userMatch._id = { $in: salesData.objectIds };
    }

    // 1. Aggregate real order revenue & buyer count by district/cityTehsil & state from Orders
    const districtOrderStats = await Order.aggregate([
      { $match: orderMatch },
      {
        $group: {
          _id: {
            district: '$shippingAddress.cityTehsil',
            state: '$shippingAddress.state'
          },
          totalRevenue: { $sum: '$totalAmount' },
          buyers: { $addToSet: '$user' },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    // 2. Group Users by district/cityTehsil to count registered farmers/dealers per district
    const districtUserStats = await User.aggregate([
      { $match: userMatch },
      {
        $group: {
          _id: {
            district: '$address.cityTehsil',
            state: '$address.state'
          },
          userCount: { $sum: 1 }
        }
      }
    ]);

    const userCountMap = new Map();
    districtUserStats.forEach(u => {
      const dist = (u._id && u._id.district ? u._id.district : '').trim().toLowerCase();
      const st = (u._id && u._id.state ? u._id.state : '').trim().toLowerCase();
      const key = `${dist}_${st}`;
      userCountMap.set(key, u.userCount);
    });

    const results = [];
    const processedKeys = new Set();

    districtOrderStats.forEach(stat => {
      const dist = (stat._id && stat._id.district ? stat._id.district : 'Unknown').trim();
      const st = (stat._id && stat._id.state ? stat._id.state : 'Maharashtra').trim();
      const key = `${dist.toLowerCase()}_${st.toLowerCase()}`;
      processedKeys.add(key);

      const buyersCount = salesData
        ? stat.buyers.filter(b => b && salesData.idSet.has(b.toString().toLowerCase())).length
        : stat.buyers.length;
      if (salesData && buyersCount === 0) return;

      const totalUsersInDistrict = Math.max(userCountMap.get(key) || 0, buyersCount);
      const conversionRate = totalUsersInDistrict > 0 ? Math.min(100.0, Number(((buyersCount / totalUsersInDistrict) * 100).toFixed(1))) : 0.0;
      const searchVolumeIndex = Math.min(99, Math.max(10, Math.round((stat.orderCount * 15) + (buyersCount * 5))));

      if (stat.totalRevenue > 0) {
        results.push({
          districtName: dist,
          stateName: st,
          primaryCrop: 'Agri Inputs & Crops',
          activeFarmers: totalUsersInDistrict,
          searchVolumeIndex: searchVolumeIndex,
          conversionRate: conversionRate,
          grossRevenueRupees: stat.totalRevenue
        });
      }
    });

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};
