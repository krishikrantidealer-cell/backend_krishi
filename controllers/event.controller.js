const Event = require('../models/Event');
const mongoose = require('mongoose');
const User = require('../models/User');
const { redisClient } = require('../config/redis');
const { sendToAll } = require('../services/websocket.service');
const { autoIdentifyDistrict, autoIdentifyState } = require('../utils/geoNormalizer');

function calculateIntentScore(screen = '', action = '', payload = {}) {
  let score = 10;
  const lowerScreen = String(screen || '').toLowerCase();
  const lowerAction = String(action || '').toLowerCase();

  if (lowerScreen.includes('checkout') || lowerScreen.includes('payment') || lowerAction.includes('checkout') || lowerAction.includes('order')) {
    score += 65;
  } else if (lowerScreen.includes('cart') || lowerAction.includes('cart') || lowerAction.includes('add_to_cart')) {
    score += 45;
  } else if (lowerScreen.includes('product') || lowerAction.includes('product') || lowerAction.includes('search')) {
    score += 30;
  } else if (lowerScreen.includes('kyc') || lowerAction.includes('kyc')) {
    score += 25;
  }

  if (payload && (payload.cartCount > 0 || payload.itemCount > 0)) {
    score += 15;
  }

  let label = 'Browsing 🍃';
  let badgeColor = 'blue';
  if (score >= 70) {
    label = 'Hot Intent 🔥';
    badgeColor = 'red';
  } else if (score >= 35) {
    label = 'Warm Interest ☀️';
    badgeColor = 'orange';
  }

  return { intentScore: String(Math.min(100, score)), intentLabel: label, intentBadgeColor: badgeColor };
}

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
      role: role || 'user' // Default to user role for direct app ingestion
    });

    // Update Real-time Presence in Redis
    if (redisClient.isOpen && user) {
      const presenceKey = `presence:${user}`;
      const intentInfo = calculateIntentScore(payload?.screen || 'Active', eventType, payload);
      const presenceData = {
        lastSeen: new Date().toISOString(),
        currentScreen: payload?.screen || 'Active',
        action: eventType,
        device: device || 'Unknown',
        intentScore: intentInfo.intentScore,
        intentLabel: intentInfo.intentLabel
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
      let userName = 'New User';
      let userPhone = 'N/A';
      let userRole = 'user';
      try {
        const userData = await User.findOne({
          $or: [{ email: user }, { phoneNumber: user }, { _id: mongoose.Types.ObjectId.isValid(user) ? user : null }]
        }).select('firstName lastName shopName phoneNumber role');

        if (userData) {
          userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.shopName || 'New User';
          userPhone = userData.phoneNumber || 'N/A';
          userRole = userData.role || 'user';
        }
      } catch (_) {}

      const intentInfo = calculateIntentScore(currentScreen, lastAction);

      const presenceData = {
        lastSeen: new Date().toISOString(),
        currentScreen: currentScreen || 'Active',
        action: lastAction || 'Browsing',
        device: device || 'Unknown',
        userName,
        userPhone,
        role: userRole,
        intentScore: intentInfo.intentScore,
        intentLabel: intentInfo.intentLabel
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
      let userName = 'New User';
      let userPhone = 'N/A';
      try {
        const userData = await User.findOne({
          $or: [{ email: user }, { phoneNumber: user }, { _id: mongoose.Types.ObjectId.isValid(user) ? user : null }]
        }).select('firstName lastName shopName phoneNumber');

        if (userData) {
          userName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.shopName || 'New User';
          userPhone = userData.phoneNumber || 'N/A';
        }
      } catch (_) {}

      const presenceData = {
        lastSeen: new Date().toISOString(),
        currentScreen: String(lastEvent.properties?.screen || lastEvent.payload?.screen || 'Active'),
        action: String(lastEvent.event || lastEvent.eventType || 'unknown'),
        device: String(lastEvent.device || lastEvent.platform || 'Unknown'),
        sessionId: String(lastEvent.sessionId || 'unknown'),
        userName: String(userName || 'New User'),
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
      const cleanUser = String(user).trim();
      resolvedIdentifiers = [cleanUser, cleanUser.toLowerCase()];
      try {
        const isPhone = /^\+?\d{7,15}$/.test(cleanUser);
        const searchCond = isPhone
          ? [{ phoneNumber: cleanUser }]
          : [
              { email: new RegExp(`^${cleanUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
              { phoneNumber: cleanUser },
              { firstName: new RegExp(cleanUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
              { lastName: new RegExp(cleanUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
              { shopName: new RegExp(cleanUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
            ];

        if (mongoose.Types.ObjectId.isValid(cleanUser)) {
          searchCond.push({ _id: new mongoose.Types.ObjectId(cleanUser) });
        }

        const matchedUsers = await User.find({ $or: searchCond })
          .select('_id email phoneNumber')
          .lean();
        
        matchedUsers.forEach(u => {
          if (u.email && u.email.trim()) resolvedIdentifiers.push(u.email.trim(), u.email.trim().toLowerCase());
          if (u.phoneNumber && u.phoneNumber.trim()) resolvedIdentifiers.push(u.phoneNumber.trim());
          if (u._id) resolvedIdentifiers.push(u._id.toString());
        });
      } catch (_) {}

      resolvedIdentifiers = [...new Set(resolvedIdentifiers.filter(Boolean))];
      if (actorOnly === 'true') {
        query.user = { $in: resolvedIdentifiers };
      } else {
        query.$or = [
          { user: { $in: resolvedIdentifiers } },
          ...resolvedIdentifiers.map(id => ({ "payload.targetUserId": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.userId": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.dealerId": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.leadId": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.targetEmail": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.dealerEmail": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.userEmail": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.targetPhone": id })),
          ...resolvedIdentifiers.map(id => ({ "payload.dealerPhone": id }))
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

    // 5. Enrich with User Details (Both Actors & Target Customers)
    const rawUserKeys = [];
    rawEvents.forEach(e => {
      if (e.user) rawUserKeys.push(e.user);
      if (e.payload) {
        const p = e.payload;
        if (p.targetUserId) rawUserKeys.push(p.targetUserId);
        if (p.userId) rawUserKeys.push(p.userId);
        if (p.dealerId) rawUserKeys.push(p.dealerId);
        if (p.leadId) rawUserKeys.push(p.leadId);
        if (p.targetEmail) rawUserKeys.push(p.targetEmail);
        if (p.dealerEmail) rawUserKeys.push(p.dealerEmail);
        if (p.userEmail) rawUserKeys.push(p.userEmail);
        if (p.targetPhone) rawUserKeys.push(p.targetPhone);
        if (p.dealerPhone) rawUserKeys.push(p.dealerPhone);
      }
    });

    const uniqueIdentifiers = [...new Set(rawUserKeys.filter(Boolean))];
    const userOrConditions = uniqueIdentifiers.map(u => {
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
      const rawName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      const hasRealName = rawName.length > 0 &&
                         !rawName.toLowerCase().includes('admin') &&
                         !rawName.toLowerCase().includes('sales');

      const name = hasRealName ? rawName : (u.shopName || u.phoneNumber || 'New Customer');
      const info = { ...u, name };

      if (u.email) userMap.set(u.email.toLowerCase(), info);
      if (u._id) userMap.set(u._id.toString(), info);

      if (u.phoneNumber) {
        userMap.set(u.phoneNumber, info);
        // Normalize: Index by last 10 digits for loose matching
        const clean = u.phoneNumber.replace(/\D/g, '');
        if (clean.length >= 10) {
          userMap.set(clean.slice(-10), info);
        }
      }
    });

    const enrichedEvents = rawEvents.map(event => {
      const actorKey = event.user ? event.user.toString() : '';
      const isActorId = mongoose.Types.ObjectId.isValid(actorKey);
      const actorLast10 = !isActorId ? actorKey.replace(/\D/g, '').slice(-10) : '';

      // Try exact, then lowercase, then last 10 digits normalization (only for non-IDs)
      const actorUser = userMap.get(actorKey) ||
                        userMap.get(actorKey.toLowerCase()) ||
                        (actorLast10.length === 10 ? userMap.get(actorLast10) : null);

      // Smart Actor Name Resolution
      let actorName = actorKey || 'Unknown';
      if (actorUser) {
        const isActuallyStaff = actorUser.role === 'admin' || actorUser.role === 'sales';
        const nameVal = String(actorUser.name || '');
        const isPlaceholderName = nameVal === 'New Customer' ||
                                 /^\d+$/.test(nameVal) ||
                                 nameVal.toLowerCase().includes('admin') ||
                                 nameVal.toLowerCase().includes('sales');

        if (isActuallyStaff) {
          actorName = (!isPlaceholderName ? nameVal : actorUser.email) || (actorUser.role === 'sales' ? 'Sales Agent' : 'Admin User');
        } else {
          // Customer: Use name if real, else fallback to phone
          actorName = !isPlaceholderName ? nameVal : (actorUser.phoneNumber || actorKey);
        }
      } else if (actorKey === 'anonymous' || actorKey === 'guest') {
        actorName = 'Guest User';
      }

      // Check if event targets a customer in payload
      const p = event.payload || {};
      const targetKey = (p.targetUserId || p.userId || p.dealerId || p.leadId || p.targetEmail || p.dealerEmail || p.userEmail || p.targetPhone || p.dealerPhone || '').toString();
      const isTargetId = mongoose.Types.ObjectId.isValid(targetKey);
      const targetLast10 = !isTargetId ? targetKey.replace(/\D/g, '').slice(-10) : '';

      const targetUser = targetKey ? (
        userMap.get(targetKey) ||
        userMap.get(targetKey.toLowerCase()) ||
        (targetLast10.length === 10 ? userMap.get(targetLast10) : null)
      ) : null;

      const isStaffAction = ['delete_lead', 'assign_agent', 'kyc_verified', 'kyc_rejected', 'toggle_block', 'create_sales_agent', 'bulk_assign_agent'].includes(event.eventType) ||
                            (actorUser && actorUser.role !== 'user');

      // Group event under Target Customer if available so staff actions show on customer timeline
      let displayUser = event.user;
      let displayUserDetails = actorUser;

      if (isStaffAction) {
        if (targetUser) {
          displayUser = targetUser.phoneNumber || targetUser.email || targetUser._id.toString();
          displayUserDetails = targetUser;
        } else if (targetKey) {
          displayUser = targetKey;
          displayUserDetails = null;
        }
      }

      return {
        ...event,
        user: displayUser,
        actor: actorKey,
        performedBy: actorName,
        userDetails: displayUserDetails ? {
          _id: displayUserDetails._id,
          firstName: displayUserDetails.firstName,
          lastName: displayUserDetails.lastName,
          phoneNumber: displayUserDetails.phoneNumber,
          shopName: displayUserDetails.shopName,
          role: displayUserDetails.role,
          kycStatus: displayUserDetails.kycStatus,
          userType: displayUserDetails.userType
        } : null,
        payload: {
          ...(event.payload || {}),
          performedBy: actorName,
        }
      };
    }).filter(event => {
      if (user) return true;
      // In main customer feed, exclude staff events that do not target a customer
      const isCustomerEvent = (event.role || 'user').toLowerCase() === 'user' || (event.userDetails?.role?.toLowerCase() === 'user');
      const isTargetedAction = event.payload && (event.payload.targetUserId || event.payload.userId || event.payload.leadId || event.payload.dealerId);
      return isCustomerEvent || isTargetedAction;
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
      const userKey = raw.user ? raw.user.toString() : '';
      const isId = mongoose.Types.ObjectId.isValid(userKey);
      const userLast10 = !isId ? userKey.replace(/\D/g, '').slice(-10) : '';

      const match = users.find(u =>
        u.email === userKey ||
        u.phoneNumber === userKey ||
        u._id.toString() === userKey ||
        (!isId && userLast10.length === 10 && u.phoneNumber && u.phoneNumber.replace(/\D/g, '').slice(-10) === userLast10)
      );
      const computedName = match ? (`${match.firstName || ''} ${match.lastName || ''}`.trim() || match.shopName) : (raw.userName !== 'Unknown' && raw.userName !== 'Guest' ? raw.userName : '');
      const finalName = (computedName && computedName.trim().length > 0 && !computedName.toLowerCase().includes('admin')) ? computedName.trim() : 'New Customer';
      const intentInfo = calculateIntentScore(raw.currentScreen, raw.action);
      return {
        ...raw,
        userName: finalName,
        userPhone: match ? match.phoneNumber : (raw.userPhone || 'N/A'),
        role: match ? match.role : (raw.role || 'user'),
        intentScore: raw.intentScore || intentInfo.intentScore,
        intentLabel: raw.intentLabel || intentInfo.intentLabel
      };
    }).filter(u => {
      // STRICTLY ONLY show users with role 'user' (Exclude admins and sales reps)
      const isRoleUser = (u.role || 'user').toLowerCase() === 'user';
      const isNameOrEmailAdmin = (u.user || '').toLowerCase().includes('admin') ||
                                (u.user || '').toLowerCase().includes('sales') ||
                                (u.userName || '').toLowerCase().includes('admin') ||
                                (u.userName || '').toLowerCase().includes('sales');
      return isRoleUser && !isNameOrEmailAdmin;
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
  if (agentIdStr && mongoose.Types.ObjectId.isValid(agentIdStr)) {
    orConditions.push({ assignedAgent: new mongoose.Types.ObjectId(agentIdStr) });
    orConditions.push({ assignedAgentId: agentIdStr });
  }

  // If we have an email but no valid ObjectId for it yet, we don't want to crash.
  // We only query assignedAgent with things that look like ObjectIds if the schema expects ObjectIds.
  // If there are legacy records with email strings, they would be in a different field or we'd need a different approach.

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
 * Funnel Analytics Aggregation - Uses Actual Collections for Precision
 */
exports.getFunnelData = async (req, res, next) => {
  try {
    const Order = require('../models/Order');
    const User = require('../models/User');
    const Cart = require('../models/Cart');
    const CheckoutSession = require('../models/CheckoutSession');

    const assignedUserData = await getSalesAssignedUserData(req);
    const { days = 'all', startDate: reqStart, endDate: reqEnd } = req.query;
    let startDate = new Date(0);
    let endDate = new Date();

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

    const timeframeQuery = { createdAt: { $gte: startDate, $lte: endDate } };
    const cartTimeframeQuery = { updatedAt: { $gte: startDate, $lte: endDate } };

    // Function to filter user sets by sales agent assignment
    const filterByAssignment = (userSet) => {
      if (!assignedUserData) return userSet.size;
      let count = 0;
      userSet.forEach(u => {
        if (assignedUserData.idSet.has(u.toString().toLowerCase())) {
          count++;
        }
      });
      return count;
    };

    // --- STEP 4: Successful Purchases (Orders) ---
    const orders = await Order.find({
      ...timeframeQuery,
      orderStatus: { $ne: 'Cancelled' }
    }).select('user').lean();
    const step4UserSet = new Set(orders.map(o => o.user.toString()));
    const step4Count = filterByAssignment(step4UserSet);

    // --- STEP 3: Initiated Checkout (Sessions + History) ---
    const checkouts = await CheckoutSession.find(timeframeQuery).select('user').lean();
    const step3UserSet = new Set(checkouts.map(c => c.user.toString()));
    const historicalIntentUsers = await Event.distinct('user', {
      timestamp: { $gte: startDate, $lte: endDate },
      eventType: { $in: ['checkout_started', 'checkout_init', 'payment_failed', 'payment_fail', 'payment_initiated', 'apply_coupon'] }
    });
    historicalIntentUsers.forEach(u => { if (u && u !== 'guest') step3UserSet.add(u.toString()); });
    step4UserSet.forEach(u => step3UserSet.add(u));
    const step3Count = filterByAssignment(step3UserSet);

    // --- STEP 2: Added to Cart (Active Carts + Checkouts) ---
    const carts = await Cart.find({
      ...cartTimeframeQuery,
      'items.0': { $exists: true }
    }).select('user').lean();
    const step2UserSet = new Set(carts.map(c => c.user.toString()));
    const historicalCartUsers = await Event.distinct('user', {
      timestamp: { $gte: startDate, $lte: endDate },
      eventType: { $in: ['add_to_cart', 'cart_add', 'cart_view'] }
    });
    historicalCartUsers.forEach(u => { if (u && u !== 'guest') step2UserSet.add(u.toString()); });
    step3UserSet.forEach(u => step2UserSet.add(u));
    const step2Count = filterByAssignment(step2UserSet);

    // --- STEP 1: App Visits & Browsing (Source: Events + Cart Fallback) ---
    const step1Users = await Event.distinct('user', {
      timestamp: { $gte: startDate, $lte: endDate },
      user: { $nin: ['anonymous', 'guest', 'unknown', null] }
    });
    const step1UserSet = new Set(step1Users.map(u => u.toString()));
    step2UserSet.forEach(u => step1UserSet.add(u));
    const step1Count = assignedUserData
      ? Array.from(step1UserSet).filter(u => assignedUserData.idSet.has(u.toString().toLowerCase())).length
      : step1UserSet.size;

    // --- Event Volume Metrics (Total Count of Actions) ---
    const eventMatch = {
      timestamp: { $gte: startDate, $lte: endDate },
      user: { $nin: ['anonymous', 'guest', 'unknown', null] }
    };
    if (assignedUserData) {
      eventMatch.user = { $in: Array.from(assignedUserData.idSet) };
    }

    const rawCounts = await Event.aggregate([
      { $match: eventMatch },
      { $group: { _id: '$eventType', count: { $sum: 1 } } }
    ]);

    const countMap = {};
    let totalEventVolume = 0;
    rawCounts.forEach(c => {
      countMap[c._id] = c.count;
      totalEventVolume += c.count;
    });

    const getStageEventCount = (aliases) => {
      return aliases.reduce((sum, a) => sum + (countMap[a] || 0), 0);
    };

    const stageData = [
      {
        stepName: '1. App Visits & Browsing',
        userCount: step1Count,
        // Step 1 eventCount represents the total baseline activity (88.9k in your case)
        eventCount: totalEventVolume || step1Count
      },
      {
        stepName: '2. High Interest (Added to Cart)',
        userCount: step2Count,
        // Represents total add_to_cart volume (15.3k in your case)
        eventCount: getStageEventCount(['add_to_cart', 'cart_add', 'cart_view']) || step2Count
      },
      {
        stepName: '3. Initiated Checkout',
        userCount: step3Count,
        // Represents total checkout flow volume (481 in your case)
        eventCount: getStageEventCount(['checkout_started', 'checkout_init', 'apply_coupon', 'payment_initiated', 'payment_failed', 'payment_fail']) || step3Count
      },
      {
        stepName: '4. Successful Purchases',
        userCount: step4Count,
        // Represents total success volume (62 in your case)
        eventCount: getStageEventCount(['payment_success', 'payment_completed', 'order_placed', 'order_created', 'order_completed']) || step4Count
      }
    ];

    // Ensure event counts follow funnel logic visually
    for (let i = stageData.length - 2; i >= 0; i--) {
      if (stageData[i].eventCount < stageData[i + 1].eventCount) {
        stageData[i].eventCount = stageData[i + 1].eventCount;
      }
    }

    // Final formatting with conversion rates
    const formatted = stageData.map((s, idx) => {
      const conversionRate = step1Count > 0
        ? Math.min(100.0, Number(((s.userCount / step1Count) * 100).toFixed(1)))
        : 0.0;

      return {
        stepName: s.stepName,
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
// Multilingual State and District Normalization Dictionaries

const DISTRICT_ALIASES = {
  // Maharashtra
  'पुणे': 'Pune', 'पुणे जिल्हा': 'Pune', 'పుణే': 'Pune', 'ಪುಣೆ': 'Pune', 'பூனே': 'Pune',
  'नाशिक': 'Nashik', 'नासिक': 'Nashik', 'નાસિક': 'Nashik', 'ನಾಶಿಕ್': 'Nashik',
  'मुंबई': 'Mumbai', 'बंबई': 'Mumbai', 'મુંબઈ': 'Mumbai', 'மும்பை': 'Mumbai', 'ముంబై': 'Mumbai', 'ಮುಂಬೈ': 'Mumbai',
  'नागपुर': 'Nagpur', 'નાગપુર': 'Nagpur', 'நாக்பூர்': 'Nagpur', 'నాగ్‌పూర్': 'Nagpur',
  'सोलापूर': 'Solapur', 'सोलापुर': 'Solapur',
  'सातारा': 'Satara',
  'कोल्हापूर': 'Kolhapur', 'कोल्हापुर': 'Kolhapur',
  'अहमदनगर': 'Ahmednagar', 'अहिल्या नगर': 'Ahmednagar', 'अहिल्यानगर': 'Ahmednagar',
  'औरंगाबाद': 'Chhatrapati Sambhajinagar', 'छत्रपती संभाजीनगर': 'Chhatrapati Sambhajinagar', 'छत्रपति संभाजीनगर': 'Chhatrapati Sambhajinagar', 'aurangabad': 'Chhatrapati Sambhajinagar',
  'सांगली': 'Sangli',
  'लातूर': 'Latur', 'लातुर': 'Latur',
  'नांदेड': 'Nanded',
  'जळगाव': 'Jalgaon', 'जलगांव': 'Jalgaon',
  'अमरावती': 'Amravati',
  'ठाणे': 'Thane', 'ठाणा': 'Thane',
  'पालघर': 'Palghar',
  'रायगड': 'Raigad', 'रायगढ़': 'Raigad',
  'धुळे': 'Dhule', 'धुलिया': 'Dhule',
  'जालना': 'Jalna',
  'यवतमाळ': 'Yavatmal', 'यवतमाल': 'Yavatmal',
  'अकोला': 'Akola',
  'बुलढाणा': 'Buldhana', 'बुलढाना': 'Buldhana',
  'भंडारा': 'Bhandara',
  'चंद्रपूर': 'Chandrapur', 'चंद्रपुर': 'Chandrapur',
  'गोंदिया': 'Gondia',
  'हिंगोली': 'Hingoli',
  'धाराशिव': 'Dharashiv', 'उस्मानाबाद': 'Dharashiv', 'dharashiv': 'Dharashiv', 'osmanabad': 'Dharashiv',
  'परभणी': 'Parbhani',
  'रत्नागिरी': 'Ratnagiri',
  'सिंधुदुर्ग': 'Sindhudurg',
  'वाशिम': 'Washim',
  'वर्धा': 'Wardha',
  'गडचिरोली': 'Gadchiroli',

  // Gujarat
  'सूरत': 'Surat', 'સુરત': 'Surat',
  'राजकोट': 'Rajkot', 'રાજકોટ': 'Rajkot',
  'अहमदाबाद': 'Ahmedabad', 'અમેદાવાદ': 'Ahmedabad', 'અમદાવાદ': 'Ahmedabad',
  'वडोदरा': 'Vadodara', 'વડોદરા': 'Vadodara', 'बड़ौदा': 'Vadodara',
  'गांधीनगर': 'Gandhinagar', 'ગાંધીનગર': 'Gandhinagar',

  // Karnataka
  'बेंगलुरु': 'Bengaluru', 'बंगलौर': 'Bengaluru', 'ಬೆಂಗಳೂರು': 'Bengaluru', 'బెంగళూరు': 'Bengaluru',
  'मैसूर': 'Mysuru', 'ಮೈಸೂರು': 'Mysuru',
  'हुबली': 'Hubballi', 'ಹುಬ್ಬಳ್ಳಿ': 'Hubballi',
  'बेलगाम': 'Belagavi', 'ಬೆಳಗಾವಿ': 'Belagavi',

  // Telangana / AP
  'हैदराबाद': 'Hyderabad', 'హైదరాబాద్': 'Hyderabad',
  'विजयवाडा': 'Vijayawada', 'విజయవాడ': 'Vijayawada',
  'विशाखापत्तनम': 'Visakhapatnam', 'విశాఖపట్నం': 'Visakhapatnam',

  // Tamil Nadu
  'चेन्नई': 'Chennai', 'சென்னை': 'Chennai',
  'कोयंबटूर': 'Coimbatore', 'கோயம்புத்தூர்': 'Coimbatore',
  'मदुरै': 'Madurai', 'மதுரை': 'Madurai',

  // Rajasthan
  'जयपुर': 'Jaipur', 'જયપુર': 'Jaipur',
  'जोधपुर': 'Jodhpur',
  'उदयपुर': 'Udaipur',
  'कोटा': 'Kota',
};


function cleanGeoString(str) {
  return str.replace(/[\s\u00A0._\-]+/g, '').toLowerCase();
}

function normalizeGeoName(input, aliasMap, stateContext = '') {
  if (!input || typeof input !== 'string') return '';
  const cleaned = input.trim();
  if (!cleaned) return '';

  // Reject phone numbers, IDs, and other pure numeric garbage (only 6-digit pincodes are valid numbers)
  if (/^\d+$/.test(cleaned) && cleaned.length !== 6) return '';
  if (cleaned.length < 2) return '';

  // First: Automatically identify using 154k Indian location dataset
  const autoResolved = autoIdentifyDistrict(cleaned, stateContext);
  if (autoResolved && autoResolved.toLowerCase() !== 'unknown') {
    for (const [key, val] of Object.entries(aliasMap)) {
      if (cleanGeoString(key) === cleanGeoString(autoResolved)) {
        return val;
      }
    }
    return autoResolved;
  }

  // Fallback checks
  const parts = cleaned.split(/[,()/\\-]+/).map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const partClean = cleanGeoString(part);
    for (const [key, val] of Object.entries(aliasMap)) {
      if (cleanGeoString(key) === partClean) {
        return val;
      }
    }
  }

  let stripped = cleaned
    .replace(/\b(tehsil|tahsil|taluka|taluk|district|dist|block|mandal|gram|panchayat|city|town|jilla|jila|जिला|जिल्हा|જિલ્લો|జిల్లా|ಜಿಲ್ಲೆ|மாவட்டம்|प्रदेश|राज्य)\b/gi, '')
    .replace(/[\s\u00A0._\-]+/g, ' ')
    .trim();

  if (!stripped) stripped = cleaned;
  const strippedClean = cleanGeoString(stripped);

  for (const [key, val] of Object.entries(aliasMap)) {
    if (cleanGeoString(key) === strippedClean) {
      return val;
    }
  }

  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

exports.getDistrictAnalytics = async (req, res, next) => {
  try {
    const Order = require('../models/Order');
    const User = require('../models/User');
    const Product = require('../models/Product');
    const Category = require('../models/Category');
    const Collection = require('../models/Collection');

    const { days = 'all', startDate: reqStart, endDate: reqEnd } = req.query;
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

    const orderMatch = {
      orderStatus: { $ne: 'Cancelled' },
      $or: [
        { 'shippingAddress.pincode': { $exists: true, $ne: '' } },
        { 'shippingAddress.cityTehsil': { $exists: true, $ne: '' } },
        { 'shippingAddress.district': { $exists: true, $ne: '' } },
        { 'shippingAddress.city': { $exists: true, $ne: '' } },
        { 'shippingAddress.villageArea': { $exists: true, $ne: '' } },
        { 'shippingAddress.addressLine2': { $exists: true, $ne: '' } },
        { 'shippingAddress.address2': { $exists: true, $ne: '' } }
      ]
    };

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
    }

    // 1. Fetch real master taxonomy from MongoDB
    const [allCategories, allCollections, allProducts] = await Promise.all([
      Category.find({}).lean(),
      Collection.find({}).lean(),
      Product.find({}).select('title categoryId subCategoryId brandName vendor').lean()
    ]);

    const categoryMap = new Map();
    const subCategoryMap = new Map();
    allCategories.forEach(c => {
      if (c && c.name) {
        categoryMap.set(c._id.toString(), c.name);
        if (Array.isArray(c.subCategories)) {
          c.subCategories.forEach(sc => {
            if (sc && sc.name) {
              subCategoryMap.set(sc._id ? sc._id.toString() : sc.name, sc.name);
            }
          });
        }
      }
    });

    const collectionMap = new Map();
    const subCollectionMap = new Map();
    allCollections.forEach(col => {
      if (col && col.name) {
        collectionMap.set(col._id.toString(), col.name);
        if (Array.isArray(col.subCollections)) {
          col.subCollections.forEach(sc => {
            if (sc && sc.name) {
              subCollectionMap.set(sc._id ? sc._id.toString() : sc.name, sc.name);
            }
          });
        }
      }
    });

    const productDetailMap = new Map();
    allProducts.forEach(p => {
      if (p) {
        const catName = p.categoryId ? categoryMap.get(p.categoryId.toString()) || 'General Products' : 'General Products';
        const subCatName = p.subCategoryId ? subCategoryMap.get(p.subCategoryId.toString()) || '' : '';
        productDetailMap.set(p._id.toString(), {
          title: p.title || 'Product',
          brandName: p.brandName || '',
          vendor: p.vendor || '',
          categoryName: catName,
          subCategoryName: subCatName
        });
      }
    });

    // 2. Fetch Order & User documents to aggregate with Multilingual Geographic Normalization
    const userQuery = {
      isDeleted: { $ne: true },
      role: { $nin: ['admin', 'sales'] },
      $or: [
        { kycStatus: 'verified' },
        { isKycComplete: true }
      ]
    };
    if (salesData) {
      userQuery._id = { $in: salesData.objectIds };
    }

    const [rawOrders, rawUsers] = await Promise.all([
      Order.find(orderMatch).select('shippingAddress totalAmount user items createdAt').lean(),
      User.find(userQuery).select('address cityTehsil city district state role kycStatus').lean()
    ]);

    function extractAllUserDistricts(u) {
      const addr = u.address || {};
      const fields = [
        addr.cityTehsil,
        addr.district,
        addr.villageArea,
        addr.addressLine2,
        addr.address2,
        u.cityTehsil,
        u.city,
        u.district
      ];
      const found = new Set();
      fields.forEach(f => {
        if (f && typeof f === 'string' && f.trim().length > 0) {
          const val = f.trim();
          const norm = normalizeGeoName(val, DISTRICT_ALIASES);
          if (norm && norm.toLowerCase() !== 'unknown') {
            found.add(norm.toLowerCase());
          }
          val.split(/[,/\s]+/).forEach(part => {
            if (part.trim().length >= 3) {
              const pNorm = normalizeGeoName(part.trim(), DISTRICT_ALIASES);
              if (pNorm && pNorm.toLowerCase() !== 'unknown') {
                found.add(pNorm.toLowerCase());
              }
            }
          });
        }
      });
      return Array.from(found);
    }

    // Group Registered Dealers by Normalized District & State with Multi-field Fallback
    const userCountMapByGeo = new Map();
    const userCountMapByDist = new Map();
    const userGeoNamesMap = new Map();

    rawUsers.forEach(u => {
      const addr = u.address || {};
      const rawPin = (addr.pincode || '').toString().trim();
      let normDist = '';
      let normSt = '';

      if (rawPin && /^\d{6}$/.test(rawPin)) {
        normDist = autoIdentifyDistrict(rawPin);
        normSt = autoIdentifyState(rawPin);
      }

      if (!normDist || !normSt) {
        const rawSt = (addr.state || u.state || '').toString().trim();
        const rawDist = (
          addr.district ||
          u.district ||
          addr.cityTehsil ||
          u.cityTehsil ||
          u.city ||
          addr.villageArea ||
          addr.addressLine2 ||
          addr.address2 ||
          ''
        ).toString().trim();

        if (rawDist) {
          if (!normDist) normDist = normalizeGeoName(rawDist, DISTRICT_ALIASES, rawSt);
          if (!normSt) normSt = rawSt ? autoIdentifyState(rawSt) : '';
        }
      }

      if (!normDist || normDist.toLowerCase() === 'unknown') {
        normDist = 'Other District';
      }
      if (!normSt) {
        normSt = 'Maharashtra';
      }

      const distKey = normDist.toLowerCase();
      const geoKey = `${distKey}_${normSt.toLowerCase()}`;
      userCountMapByDist.set(distKey, (userCountMapByDist.get(distKey) || 0) + 1);
      userCountMapByGeo.set(geoKey, (userCountMapByGeo.get(geoKey) || 0) + 1);
      if (!userGeoNamesMap.has(geoKey)) {
        userGeoNamesMap.set(geoKey, { districtName: normDist, stateName: normSt });
      }
    });

    // Group Orders by Normalized District & State
    const districtAggMap = new Map();
    rawOrders.forEach(ord => {
      const ship = ord.shippingAddress || {};
      const rawPin = (ship.pincode || '').toString().trim();
      let normDist = '';
      let normSt = '';

      if (rawPin && /^\d{6}$/.test(rawPin)) {
        normDist = autoIdentifyDistrict(rawPin);
        normSt = autoIdentifyState(rawPin);
      }

      if (!normDist || !normSt) {
        const rawSt = ship.state || '';
        const rawDist = (
          ship.district ||
          ship.cityTehsil ||
          ship.city ||
          ship.villageArea ||
          ship.addressLine2 ||
          ship.address2 ||
          ''
        ).toString().trim();

        if (rawDist) {
          if (!normDist) normDist = normalizeGeoName(rawDist, DISTRICT_ALIASES, rawSt) || 'Unknown';
          if (!normSt) normSt = rawSt ? autoIdentifyState(rawSt) : 'Madhya Pradesh';
        }
      }

      if (normDist) {
        if (!normSt) normSt = 'Madhya Pradesh'; // Ultimate fallback
        const geoKey = `${normDist.toLowerCase()}_${normSt.toLowerCase()}`;

        if (!districtAggMap.has(geoKey)) {
          districtAggMap.set(geoKey, {
            districtName: normDist,
            stateName: normSt,
            totalRevenue: 0,
            buyersSet: new Set(),
            orderCount: 0,
            orderDocs: []
          });
        }

        const agg = districtAggMap.get(geoKey);
        agg.totalRevenue += (ord.totalAmount || 0);
        if (ord.user) agg.buyersSet.add(ord.user.toString());
        agg.orderCount += 1;
        if (Array.isArray(ord.items)) {
          agg.orderDocs.push({ items: ord.items });
        }
      }
    });

    // Ensure all districts with registered dealers exist in districtAggMap
    userGeoNamesMap.forEach((meta, geoKey) => {
      if (!districtAggMap.has(geoKey)) {
        districtAggMap.set(geoKey, {
          districtName: meta.districtName,
          stateName: meta.stateName,
          totalRevenue: 0,
          buyersSet: new Set(),
          orderCount: 0,
          orderDocs: []
        });
      }
    });

    const results = [];

    districtAggMap.forEach((agg, geoKey) => {
      const buyersList = Array.from(agg.buyersSet);
      const buyersCount = salesData
        ? buyersList.filter(b => b && salesData.idSet.has(b.toLowerCase())).length
        : buyersList.length;
      const distKey = agg.districtName.toLowerCase();
      const registeredDealers = userCountMapByGeo.get(geoKey) || userCountMapByDist.get(distKey) || 0;

      if (salesData && buyersCount === 0 && registeredDealers === 0) return;

      const conversionRate = registeredDealers > 0
        ? Math.min(100.0, Number(((buyersCount / registeredDealers) * 100).toFixed(1)))
        : (buyersCount > 0 ? 100.0 : 0.0);

      const categoryBreakdown = {};
      const subCategoryBreakdown = {};
      const productBreakdown = {};

      agg.orderDocs.forEach(ord => {
        if (Array.isArray(ord.items)) {
          ord.items.forEach(item => {
            const pId = item.product ? item.product.toString() : '';
            const pMeta = productDetailMap.get(pId) || {
              title: item.title || 'Product',
              categoryName: 'General Products',
              subCategoryName: ''
            };
            const itemRev = (item.price || 0) * (item.quantity || 1);
            const cat = pMeta.categoryName || 'General Products';
            categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + itemRev;
            if (pMeta.subCategoryName) {
              subCategoryBreakdown[pMeta.subCategoryName] = (subCategoryBreakdown[pMeta.subCategoryName] || 0) + itemRev;
            }
            const pTitle = pMeta.title || item.title || 'Product';
            productBreakdown[pTitle] = (productBreakdown[pTitle] || 0) + itemRev;
          });
        }
      });

      let topCategory = 'General Products';
      let maxCatRev = -1;
      Object.entries(categoryBreakdown).forEach(([cat, rev]) => { if (rev > maxCatRev) { maxCatRev = rev; topCategory = cat; } });
      let topSubCategory = '';
      let maxSubRev = -1;
      Object.entries(subCategoryBreakdown).forEach(([scat, rev]) => { if (rev > maxSubRev) { maxSubRev = rev; topSubCategory = scat; } });

      if (agg.totalRevenue > 0 || registeredDealers > 0) {
        results.push({
          districtName: agg.districtName,
          stateName: agg.stateName,
          primaryCrop: topSubCategory ? `${topCategory} • ${topSubCategory}` : topCategory,
          category: topCategory,
          subCategory: topSubCategory,
          registeredDealers: registeredDealers,   // actual registered users in district
          activeBuyers: buyersCount,               // unique users who placed ≥1 order
          activeDealers: buyersCount,              // active dealers who placed ≥1 order
          searchVolumeIndex: Math.min(99, Math.max(10, Math.round((agg.orderCount * 15) + (buyersCount * 5)))),
          conversionRate: conversionRate,
          grossRevenueRupees: agg.totalRevenue,
          orderCount: agg.orderCount,
          categoryBreakdown: categoryBreakdown,
          subCategoryBreakdown: subCategoryBreakdown,
          productBreakdown: productBreakdown
        });
      }
    });

    results.sort((a, b) => b.grossRevenueRupees - a.grossRevenueRupees);

    const masterCategories = Array.from(new Set(Array.from(categoryMap.values())));
    const masterSubCategories = Array.from(new Set(Array.from(subCategoryMap.values())));
    const masterCollections = Array.from(new Set(Array.from(collectionMap.values())));
    const masterSubCollections = Array.from(new Set(Array.from(subCollectionMap.values())));

    res.json({
      success: true,
      data: results,
      masterTaxonomy: {
        categories: masterCategories,
        subCategories: masterSubCategories,
        collections: masterCollections,
        subCollections: masterSubCollections
      }
    });
  } catch (error) {
    next(error);
  }
};
