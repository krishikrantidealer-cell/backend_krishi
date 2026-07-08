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
      user,
      eventType,
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
      user: e.user,
      eventId: e.eventId,
      sessionId: e.sessionId,
      schemaVersion: e.schemaVersion || '1.0.0',
      eventType: e.event || e.eventType,
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
        currentScreen: lastEvent.properties?.screen || lastEvent.payload?.screen || 'Active',
        action: lastEvent.event || lastEvent.eventType,
        device: lastEvent.device || lastEvent.platform || 'Unknown',
        sessionId: lastEvent.sessionId || 'unknown',
        userName,
        userPhone
      };

      await redisClient.hSet(presenceKey, presenceData);
      await redisClient.expire(presenceKey, 120);

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
    const { user, before, filter } = req.query;

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
      query.$or = [
        { user: { $in: resolvedIdentifiers } },
        ...resolvedIdentifiers.map(id => ({ "payload.dealerId": id })),
        ...resolvedIdentifiers.map(id => ({ "payload.dealerEmail": id })),
        ...resolvedIdentifiers.map(id => ({ "payload.dealerPhone": id })),
        ...resolvedIdentifiers.map(id => ({ "payload.userId": id })),
        ...resolvedIdentifiers.map(id => ({ "payload.userEmail": id }))
      ];
    }

    // 2. Handle Pagination
    if (before) {
      query.timestamp = { $lt: new Date(before) };
    }

    // 3. Handle Global Filters (Abandoned Cart, Failed Payment, etc.)
    // If a filter is applied, we use an aggregation pipeline to find matching users first
    if (filter && filter !== 'All') {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const aggregationMatch = { timestamp: { $gte: fourteenDaysAgo } };
      if (query.$or) aggregationMatch.$or = query.$or;

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

        if (filter === 'High Priority') {
          const hasSuccess = types.has('payment_success');
          match = (types.has('payment_failed') && !hasSuccess) ||
                 (types.has('checkout_started') && !hasSuccess) ||
                 (types.has('add_to_cart') && !types.has('checkout_started') && !hasSuccess);
        } else if (filter === 'Abandoned Carts') {
          const hasSuccess = types.has('payment_success');
          match = (types.has('checkout_started') && !hasSuccess) ||
                 (types.has('add_to_cart') && !types.has('checkout_started') && !hasSuccess);
        } else if (filter === 'Failed Payments') {
          match = types.has('payment_failed') && !types.has('payment_success');
        }

        if (match && userState._id) {
          filteredUserIds.push(userState._id);
        }
      });

      // If no users match the filter, return early
      if (filteredUserIds.length === 0) {
        return res.json({ success: true, data: [], nextCursor: null });
      }

      // Restrict main query to these users
      query.user = { $in: filteredUserIds };
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

    const keys = await redisClient.keys('presence:*');
    const pipeline = redisClient.multi();
    keys.forEach(key => pipeline.hGetAll(key));
    const results = await pipeline.exec();

    const rawActiveUsers = keys.map((key, index) => ({
      user: key.replace('presence:', ''),
      ...results[index]
    }));

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
        userName: match ? `${match.firstName || ''} ${match.lastName || ''}`.trim() || match.shopName : 'Unknown',
        userPhone: match ? match.phoneNumber : 'N/A'
      };
    });

    res.json({ success: true, count: enrichedUsers.length, data: enrichedUsers });
  } catch (error) {
    next(error);
  }
};

/**
 * Funnel Analytics Aggregation
 */
exports.getFunnelData = async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const funnelSteps = ['product_view', 'add_to_cart', 'checkout_started', 'order_placed'];

    const results = await Event.aggregate([
      { $match: { timestamp: { $gte: startDate }, eventType: { $in: funnelSteps } } },
      { $group: { _id: '$eventType', uniqueUsers: { $addToSet: '$user' }, count: { $sum: 1 } } },
      { $project: { step: '$_id', userCount: { $size: '$uniqueUsers' }, eventCount: '$count', _id: 0 } }
    ]);

    const formatted = funnelSteps.map(step => {
      const match = results.find(r => r.step === step);
      return match || { step, userCount: 0, eventCount: 0 };
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
    const cacheKey = 'stats:events:summary-metrics:v2';
    
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

      // Resolution Logic: If they eventually succeeded, they are no longer High Priority
      const hasSuccess = types.has('payment_success');

      if (types.has('payment_failed') && !hasSuccess) {
        failedPaymentsCount++;
      } else if (types.has('checkout_started') && !hasSuccess) {
        abandonedCheckoutsCount++;
      } else if (types.has('add_to_cart') && !types.has('checkout_started') && !hasSuccess) {
        abandonedCartsCount++;
      }
    });

    const highPriorityCount = failedPaymentsCount + abandonedCheckoutsCount + abandonedCartsCount;

    const resultData = {
      highPriority: highPriorityCount,
      failedPayments: failedPaymentsCount,
      abandonedCarts: abandonedCartsCount,
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
