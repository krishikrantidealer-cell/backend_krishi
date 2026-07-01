const Event = require('../models/Event');
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
    const limit = parseInt(req.query.limit) || 1000;
    const { user } = req.query;

    const pipeline = [];
    if (user) {
      pipeline.push({
        $match: {
          $or: [
            { user: user },
            { user: user.toLowerCase() },
            { "payload.dealerId": user },
            { "payload.dealerEmail": user },
            { "payload.dealerPhone": user },
            { "payload.userId": user },
            { "payload.userEmail": user }
          ]
        }
      });
    }
    pipeline.push({ $sort: { timestamp: -1 } });
    pipeline.push({ $limit: limit });
    pipeline.push(
      {
        $lookup: {
          from: 'users',
          let: { eventUser: '$user' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ['$email', '$$eventUser'] },
                    { $eq: ['$phoneNumber', '$$eventUser'] },
                    { $eq: [{ $toString: '$_id' }, '$$eventUser'] }
                  ]
                }
              }
            },
            { $project: { firstName: 1, lastName: 1, phoneNumber: 1, shopName: 1 } }
          ],
          as: 'userDetails'
        }
      },
      {
        $addFields: {
          userDetails: { $arrayElemAt: ['$userDetails', 0] }
        }
      }
    );

    const events = await Event.aggregate(pipeline);

    res.json({ success: true, data: events });
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
