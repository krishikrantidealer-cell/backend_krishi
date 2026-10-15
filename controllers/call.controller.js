const mongoose = require('mongoose');
const CallLog = require('../models/CallLog');
const Contact = require('../models/Contact');
const User = require('../models/User');
const myoperatorCallService = require('../services/myoperatorCall.service');
const wsService = require('../services/websocket.service');

// ── In-Memory Fast Webhook Idempotency Cache (60s TTL) ───────────────────────
const webhookIdempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 60 * 1000;

function isDuplicateWebhook(key) {
  if (!key) return false;
  const now = Date.now();
  if (webhookIdempotencyCache.has(key)) {
    const expiresAt = webhookIdempotencyCache.get(key);
    if (now < expiresAt) {
      return true; // Already processed recently
    }
  }
  webhookIdempotencyCache.set(key, now + IDEMPOTENCY_TTL_MS);
  // Auto cleanup every 100 entries
  if (webhookIdempotencyCache.size > 500) {
    for (const [k, exp] of webhookIdempotencyCache.entries()) {
      if (now > exp) webhookIdempotencyCache.delete(k);
    }
  }
  return false;
}

// ── Background Auto-Sync with MyOperator REST APIs (Every 10s) ───────────────
let lastApiSyncTime = 0;
const API_SYNC_THROTTLE_MS = 6 * 1000;

function triggerBackgroundSync() {
  if (mongoose.connection.readyState !== 1) return;
  const now = Date.now();
  if (now - lastApiSyncTime > API_SYNC_THROTTLE_MS) {
    lastApiSyncTime = now;
    myoperatorCallService.syncRecentCallsFromMyOperator().catch(err => {
      console.warn('[MyOperator API Sync Warning]:', err.message);
    });
  }
}

// Background auto-sync worker
setInterval(() => {
  triggerBackgroundSync();
}, 10 * 1000);

/**
 * 1-Click Outbound Click-to-Call Trigger
 */
const triggerOutboundCall = async (req, res) => {
  try {
    const { customerPhone, callMode = 'click2call' } = req.body;
    if (!customerPhone) {
      return res.status(400).json({ success: false, message: 'Customer phone number is required' });
    }

    const agentUser = await User.findById(req.user.id);
    const agentPhone = agentUser?.phoneNumber || '';

    const result = await myoperatorCallService.triggerOutboundCall({
      agentId: req.user.id,
      customerPhone,
      agentPhone,
      callMode
    });

    res.json({
      success: true,
      message: 'Call initiated successfully via MyOperator',
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Manual / Triggered MyOperator API Sync
 */
const syncCallLogs = async (req, res) => {
  try {
    const syncedCount = await myoperatorCallService.syncRecentCallsFromMyOperator();
    res.json({
      success: true,
      message: `Successfully synced ${syncedCount} calls from MyOperator accounts`,
      syncedCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ── Strict IST (UTC+05:30) Timezone Date Resolver ───────────────────────────
function resolveDateRange({ date, startDate, endDate, timeframe }) {
  if (timeframe === 'All Time' || timeframe === 'all') return null;

  if (startDate || endDate) {
    let start = startDate ? new Date(startDate) : new Date(0);
    let end = endDate ? new Date(endDate) : new Date();
    if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate.trim())) {
      start = new Date(startDate.trim() + 'T00:00:00.000+05:30');
    }
    if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
      end = new Date(endDate.trim() + 'T23:59:59.999+05:30');
    }
    return { start, end };
  }

  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const yyyy = istNow.getUTCFullYear();
  const mm = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istNow.getUTCDate()).padStart(2, '0');
  const todayStr = yyyy + '-' + mm + '-' + dd;

  if (date === 'today' || timeframe === 'today' || timeframe === 'Today' || date === todayStr) {
    return {
      start: new Date(todayStr + 'T00:00:00.000+05:30'),
      end: new Date(todayStr + 'T23:59:59.999+05:30')
    };
  }

  if (date === 'yesterday' || timeframe === 'yesterday' || timeframe === 'Yesterday') {
    const istYesterday = new Date(istNow.getTime() - 24 * 60 * 60 * 1000);
    const yStr = istYesterday.getUTCFullYear() + '-' + String(istYesterday.getUTCMonth() + 1).padStart(2, '0') + '-' + String(istYesterday.getUTCDate()).padStart(2, '0');
    return {
      start: new Date(yStr + 'T00:00:00.000+05:30'),
      end: new Date(yStr + 'T23:59:59.999+05:30')
    };
  }

  if (timeframe === 'week' || timeframe === 'Last 1 Week' || timeframe === 'last_7_days') {
    return {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      end: now
    };
  }

  if (timeframe === 'month' || timeframe === 'Last 1 Month' || timeframe === 'last_30_days') {
    return {
      start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      end: now
    };
  }

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    return {
      start: new Date(date.trim() + 'T00:00:00.000+05:30'),
      end: new Date(date.trim() + 'T23:59:59.999+05:30')
    };
  }

  return null;
}

/**
 * Fetch Call Logs with Aggregated Telephony Metrics & Leaderboards
 */
const getCallLogs = async (req, res) => {
  try {
    // Proactively kick off sync in background
    triggerBackgroundSync();
    const {
      search,
      customerPhone,
      agentId,
      type,
      status,
      view,
      includeDeleted,
      date,
      startDate,
      endDate,
      timeframe,
      page = 1,
      limit = 25
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const andConditions = [];
    const dateRange = resolveDateRange({ date, startDate, endDate, timeframe });

    // ── Industrial Soft Delete Filter ──────────────────────────────────────────
    if (view === 'trash' || view === 'deleted') {
      andConditions.push({ isDeleted: true });
    } else if (includeDeleted !== 'true') {
      andConditions.push({ isDeleted: { $ne: true } });
    }

    // ── Phone / Customer Specific Filter vs Broad Multi-Field Search ────────
    if (customerPhone && customerPhone.trim() !== '') {
      const cleanDigits = customerPhone.replace(/\D/g, '').replace(/^91/, '');
      if (cleanDigits.length >= 5) {
        andConditions.push({ customerPhone: { $regex: cleanDigits, $options: 'i' } });
      }
    } else if (search && search.trim() !== '') {
      const searchTerm = search.trim();
      const cleanDigits = searchTerm.replace(/\D/g, '').replace(/^91/, '');
      const searchConditions = [];

      // 1. Match phone numbers if digits are present
      if (cleanDigits.length >= 1) {
        searchConditions.push({ customerPhone: { $regex: cleanDigits, $options: 'i' } });
      }

      // 2. Match contact name
      const matchingContacts = await Contact.find({
        name: { $regex: searchTerm, $options: 'i' }
      }).distinct('_id');

      if (matchingContacts.length > 0) {
        searchConditions.push({ contactId: { $in: matchingContacts } });
      }

      // 3. Match disposition, notes, and call summary
      searchConditions.push({ userDisposition: { $regex: searchTerm, $options: 'i' } });
      searchConditions.push({ notes: { $regex: searchTerm, $options: 'i' } });
      searchConditions.push({ callSummary: { $regex: searchTerm, $options: 'i' } });

      if (searchConditions.length > 0) {
        andConditions.push({ $or: searchConditions });
      }
    }

    if (type && type !== 'all' && type.trim() !== '') {
      andConditions.push({ $or: [{ direction: type }, { type: type }] });
    }

    if (status && status !== 'all' && status.trim() !== '') {
      const s = status.toLowerCase();
      if (s === 'missed') {
        andConditions.push({ status: { $in: ['missed', 'no-answer'] } });
      } else if (s === 'answered') {
        andConditions.push({ $or: [{ status: 'answered' }, { durationSeconds: { $gt: 0 } }] });
      } else {
        andConditions.push({ status: s });
      }
    }

    // ── Strict IST Timeframe / Date Range Filter ─────────────────────────────
    if (dateRange && dateRange.start && dateRange.end) {
      andConditions.push({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } });
    }

    // Role Security: Sales agents strictly ONLY see calls they made (outbound) or received (inbound)
    let metricsMatch = { isDeleted: { $ne: true } };
    if (dateRange && dateRange.start && dateRange.end) {
      metricsMatch.createdAt = { $gte: dateRange.start, $lte: dateRange.end };
    }

    if (req.user.role === 'sales') {
      const agentUser = await User.findById(req.user.id);
      const agentPhoneDigits = agentUser?.phoneNumber
        ? agentUser.phoneNumber.replace(/\D/g, '').replace(/^91/, '')
        : '';
      const agentDid = agentUser?.myoperatorConfig?.did
        ? agentUser.myoperatorConfig.did.replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '')
        : '';
      const agentVid = agentUser?.myoperatorConfig?.vid || agentUser?.myoperatorConfig?.extension;

      const salesAgentOr = [
        { agentId: req.user.id },
        { agentId: new mongoose.Types.ObjectId(req.user.id) }
      ];

      if (agentPhoneDigits) {
        salesAgentOr.push({ agentPhone: { $regex: agentPhoneDigits } });
      }
      if (agentDid) {
        salesAgentOr.push(
          { 'metadata.matchedDid': { $regex: agentDid } },
          { 'metadata.agentDid': { $regex: agentDid } },
          { 'metadata.received_on': { $regex: agentDid } }
        );
      }
      if (agentVid) {
        salesAgentOr.push(
          { 'metadata.matchedVid': agentVid },
          { 'metadata.agentVid': agentVid }
        );
      }

      if (customerPhone && customerPhone.trim() !== '') {
        const cleanCustomerDigits = customerPhone.replace(/\D/g, '').replace(/^91/, '');
        const isCustomerAssigned = await User.findOne({
          $or: [
            { phoneNumber: { $regex: cleanCustomerDigits } },
            { phone: { $regex: cleanCustomerDigits } }
          ],
          assignedAgent: req.user.id,
          isDeleted: { $ne: true }
        }).select('_id').lean();

        if (isCustomerAssigned) {
          metricsMatch = {
            ...metricsMatch,
            customerPhone: { $regex: cleanCustomerDigits, $options: 'i' }
          };
        } else {
          andConditions.push({ $or: salesAgentOr });
          metricsMatch = {
            ...metricsMatch,
            $or: salesAgentOr
          };
        }
      } else {
        andConditions.push({ $or: salesAgentOr });
        metricsMatch = {
          ...metricsMatch,
          $or: salesAgentOr
        };
      }
    } else if (agentId && agentId !== 'null' && agentId !== 'undefined' && agentId.trim() !== '' && agentId !== 'all') {
      andConditions.push({ agentId });
      if (mongoose.Types.ObjectId.isValid(agentId)) {
        metricsMatch = {
          ...metricsMatch,
          agentId: new mongoose.Types.ObjectId(agentId)
        };
      }
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const [callLogs, total, summaryResult, leaderboardResult] = await Promise.all([
      CallLog.find(query)
        .populate('agentId', 'firstName lastName email phoneNumber myoperatorConfig')
        .populate('contactId', 'name phone preferredLanguage')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),

      CallLog.countDocuments(query),

      CallLog.aggregate([
        { $match: metricsMatch },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            inboundCount: {
              $sum: {
                $cond: [
                  { $in: ['$direction', ['inbound']] },
                  1,
                  { $cond: [{ $eq: ['$type', 'inbound'] }, 1, 0] }
                ]
              }
            },
            outboundCount: {
              $sum: {
                $cond: [
                  { $in: ['$direction', ['outbound']] },
                  1,
                  { $cond: [{ $eq: ['$type', 'outbound'] }, 1, 0] }
                ]
              }
            },
            answeredCount: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'answered'] },
                      { $gt: ['$durationSeconds', 0] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            missedCount: {
              $sum: {
                $cond: [{ $in: ['$status', ['missed', 'no-answer']] }, 1, 0]
              }
            },
            totalSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } },
            uniqueCustomers: { $addToSet: '$customerPhone' }
          }
        },
        {
          $project: {
            totalCalls: 1,
            inboundCount: 1,
            outboundCount: 1,
            answeredCount: 1,
            missedCount: 1,
            totalSeconds: 1,
            uniqueCustomersCount: { $size: '$uniqueCustomers' },
            answerRatePercent: {
              $cond: [
                { $gt: ['$totalCalls', 0] },
                { $round: [{ $multiply: [{ $divide: ['$answeredCount', '$totalCalls'] }, 100] }, 1] },
                0
              ]
            }
          }
        }
      ]),

      CallLog.aggregate([
        { $match: { ...metricsMatch, agentId: { $ne: null } } },
        {
          $group: {
            _id: '$agentId',
            totalCalls: { $sum: 1 },
            talkTimeSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } },
            answeredCalls: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$status', 'answered'] },
                      { $gt: ['$durationSeconds', 0] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            outboundCalls: {
              $sum: {
                $cond: [
                  { $in: ['$direction', ['outbound']] },
                  1,
                  { $cond: [{ $eq: ['$type', 'outbound'] }, 1, 0] }
                ]
              }
            },
            inboundCalls: {
              $sum: {
                $cond: [
                  { $in: ['$direction', ['inbound']] },
                  1,
                  { $cond: [{ $eq: ['$type', 'inbound'] }, 1, 0] }
                ]
              }
            },
            missedCalls: {
              $sum: {
                $cond: [{ $in: ['$status', ['missed', 'no-answer']] }, 1, 0]
              }
            },
            firstCallAt: { $min: '$createdAt' },
            lastCallAt: { $max: '$createdAt' },
            uniqueCustomers: { $addToSet: '$customerPhone' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'agent'
          }
        },
        { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            agentId: '$_id',
            agentName: {
              $trim: {
                input: {
                  $concat: [
                    { $ifNull: ['$agent.firstName', ''] },
                    ' ',
                    { $ifNull: ['$agent.lastName', ''] }
                  ]
                }
              }
            },
            agentEmail: { $ifNull: ['$agent.email', ''] },
            agentPhone: { $ifNull: ['$agent.phoneNumber', ''] },
            myoperatorConfig: '$agent.myoperatorConfig',
            totalCalls: 1,
            outboundCalls: 1,
            inboundCalls: 1,
            answeredCalls: 1,
            missedCalls: 1,
            talkTimeSeconds: 1,
            avgHandleTimeSeconds: {
              $cond: [
                { $gt: ['$answeredCalls', 0] },
                { $round: [{ $divide: ['$talkTimeSeconds', '$answeredCalls'] }, 0] },
                0
              ]
            },
            answerRatePercent: {
              $cond: [
                { $gt: ['$totalCalls', 0] },
                { $round: [{ $multiply: [{ $divide: ['$answeredCalls', '$totalCalls'] }, 100] }, 1] },
                0
              ]
            },
            firstCallAt: 1,
            lastCallAt: 1,
            uniqueCustomersCount: { $size: '$uniqueCustomers' }
          }
        },
        { $sort: { talkTimeSeconds: -1, totalCalls: -1 } },
        { $limit: 50 }
      ])
    ]);

    // High-performance single-batch Contact enrichment for unlinked logs
    const unlinkedPhones = Array.from(new Set(
      callLogs
        .filter(l => !l.contactId && l.customerPhone)
        .map(l => l.customerPhone.replace(/\D/g, '').replace(/^91/, ''))
        .filter(p => p.length >= 7)
    ));

    let contactMap = {};
    if (unlinkedPhones.length > 0) {
      const allPhoneVariants = [
        ...unlinkedPhones,
        ...unlinkedPhones.map(p => `91${p}`),
        ...unlinkedPhones.map(p => `+91${p}`)
      ];
      const foundContacts = await Contact.find({
        phone: { $in: allPhoneVariants }
      }).select('name phone preferredLanguage').lean();

      foundContacts.forEach(c => {
        const clean = (c.phone || '').replace(/\D/g, '').replace(/^91/, '');
        if (clean) contactMap[clean] = c;
      });
    }

    const enrichedLogs = callLogs.map(log => {
      if (!log.contactId && log.customerPhone) {
        const cleanPhone = log.customerPhone.replace(/\D/g, '').replace(/^91/, '');
        if (contactMap[cleanPhone]) {
          log.contactId = contactMap[cleanPhone];
        }
      }
      return log;
    });

    const metricsSummary = summaryResult[0] || {
      totalCalls: 0,
      inboundCount: 0,
      outboundCount: 0,
      answeredCount: 0,
      missedCount: 0,
      totalSeconds: 0,
      uniqueCustomersCount: 0,
      answerRatePercent: 0
    };

    res.json({
      success: true,
      data: enrichedLogs,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
      metrics: {
        totalCalls: metricsSummary.totalCalls || 0,
        inboundCount: metricsSummary.inboundCount || 0,
        outboundCount: metricsSummary.outboundCount || 0,
        answeredCount: metricsSummary.answeredCount || 0,
        missedCount: metricsSummary.missedCount || 0,
        totalSeconds: metricsSummary.totalSeconds || 0,
        uniqueCustomersCount: metricsSummary.uniqueCustomersCount || 0,
        answerRatePercent: metricsSummary.answerRatePercent || 0,
        leaderboard: leaderboardResult || [],
        dateRange: dateRange ? {
          start: dateRange.start,
          end: dateRange.end,
          timeframe: timeframe || date || null
        } : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const saveCallDisposition = async (req, res) => {
  try {
    const { callLogId, userDisposition, followUpDate, followUpNote, notes } = req.body;

    if (!callLogId) {
      return res.status(400).json({ success: false, message: 'Call log ID is required' });
    }

    const callLog = await CallLog.findById(callLogId);
    if (!callLog) {
      return res.status(404).json({ success: false, message: 'Call log not found' });
    }

    // Role Security: Sales agents can only update dispositions on their own calls
    if (req.user.role === 'sales') {
      const agentUser = await User.findById(req.user.id);
      const agentPhoneDigits = agentUser?.phoneNumber
        ? agentUser.phoneNumber.replace(/\D/g, '').replace(/^91/, '')
        : '';
      const isMyCall =
        (callLog.agentId && callLog.agentId.toString() === req.user.id.toString()) ||
        (agentPhoneDigits && callLog.agentPhone && callLog.agentPhone.replace(/\D/g, '').includes(agentPhoneDigits));

      if (!isMyCall) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You can only update dispositions on your own call records.'
        });
      }
    }

    if (userDisposition) callLog.userDisposition = userDisposition;
    if (followUpDate) {
      callLog.followUpDate = new Date(followUpDate);
      // A newly scheduled follow-up is pending again
      callLog.followUpCompletedAt = null;
      callLog.followUpCompletedBy = null;
    }
    if (followUpNote) callLog.followUpNote = followUpNote;
    if (notes) callLog.notes = notes;

    await callLog.save();

    // ── Sync to CRM Contact & User Profile ──────────────────────────────────
    if (callLog.customerPhone && (notes || userDisposition || followUpNote)) {
      const cleanPhone = callLog.customerPhone.replace(/\D/g, '').replace(/^91/, '');
      
      // 1. Sync note and follow-up to User model (Dealer/Customer profile)
      try {
        const user = await User.findOne({
          $or: [
            { phoneNumber: cleanPhone },
            { phoneNumber: `91${cleanPhone}` },
            { phoneNumber: `+91${cleanPhone}` }
          ]
        });

        if (user) {
          const agentUser = await User.findById(req.user.id);
          const authorName = agentUser ? `${agentUser.firstName || ''} ${agentUser.lastName || ''}`.trim() || 'Agent' : 'Agent';
          const noteContent = `${notes || ''} ${followUpNote ? `[Follow-up: ${followUpNote}]` : ''}`.trim() || `Disposition: ${userDisposition || 'Call Logged'}`;

          user.notesHistory = user.notesHistory || [];
          user.notesHistory.push({
            title: `Call Disposition: ${userDisposition || 'Call Logged'}`,
            note: noteContent,
            adminId: req.user.id,
            adminName: authorName,
            author: authorName,
            createdAt: new Date(),
            type: 'call',
            priority: 'medium'
          });
          await user.save();
        }
      } catch (userErr) {
        console.warn('[Call Disposition] Warning: Could not sync note to user profile:', userErr.message);
      }

      // 2. Sync disposition tag and assignment to Contact model (WhatsApp CRM & Leads)
      try {
        const contact = await Contact.findOne({
          $or: [
            { phone: cleanPhone },
            { phone: `91${cleanPhone}` },
            { phone: `+91${cleanPhone}` }
          ]
        });

        if (contact) {
          if (!contact.assignedTo && callLog.agentId) {
            contact.assignedTo = callLog.agentId;
          }
          if (userDisposition) {
            contact.tags = contact.tags || [];
            const tagLabel = `Disposition: ${userDisposition}`;
            if (!contact.tags.includes(tagLabel)) {
              contact.tags.push(tagLabel);
            }
          }
          await contact.save();
          if (!callLog.contactId) {
            callLog.contactId = contact._id;
            await callLog.save();
          }
        }
      } catch (contactErr) {
        console.warn('[Call Disposition] Warning: Could not sync to Contact model:', contactErr.message);
      }
    }

    const populated = await CallLog.findById(callLog._id)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('contactId', 'name phone preferredLanguage');

    // Broadcast ACW update to active panels
    const broadcastPayload = { type: 'CALL_UPDATE', data: populated };
    if (callLog.agentId) wsService.sendToUser(callLog.agentId.toString(), broadcastPayload);
    wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);

    res.json({
      success: true,
      message: 'Call disposition saved successfully',
      data: populated
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Enterprise Telephony Accounts Registry (Exact MyOperator lines) ────────
const TELEPHONY_ACCOUNTS = [
  {
    name: 'Yashraj Singh (Admin)',
    email: 'admin@krishikranti.com',
    role: 'admin',
    accountName: 'Main Account (6ab0de5d51766538)',
    companyId: '6ab0de5d51766538',
    did: '07316917246',
    outboundNumber: '+91 7316917246',
    mobileNumber: '7316917246',
    isAdmin: true
  },
  {
    name: 'Anshika Gupta',
    email: 'ebsale08@gmail.com',
    role: 'sales',
    accountName: 'Ram Ji Shukla - 2 (6abcea24dbd6a999)',
    companyId: '6abcea24dbd6a999',
    did: '07316917267',
    outboundNumber: '+91 7316917267',
    mobileNumber: '9399022067'
  },
  {
    name: 'Runa Singh',
    email: 'essentialsale14@gmail.com',
    role: 'sales',
    accountName: 'Ram Ji Shukla - 3 (6abcea4e66e65852)',
    companyId: '6abcea4e66e65852',
    did: '07316917220',
    outboundNumber: '+91 7316917220',
    mobileNumber: '9201896604'
  },
  {
    name: 'Ajay Yadav',
    email: 'essentialsale8@gmail.com',
    role: 'sales',
    accountName: 'Ram Ji Shukla - 4 (6abcea68a9843790)',
    companyId: '6abcea68a9843790',
    did: '07316917210',
    outboundNumber: '+91 7316917210',
    mobileNumber: '9201896606'
  },
  {
    name: 'Yogesh Nandwanshi',
    email: 'sales3.essential@gmail.com',
    role: 'sales',
    accountName: 'Ram Ji Shukla - 5 (6abcea80a6fa9438)',
    companyId: '6abcea80a6fa9438',
    did: '07316917208',
    outboundNumber: '+91 7316917208',
    mobileNumber: '9399022063'
  },
  {
    name: 'Garima Gokulpure',
    email: 'essentialbiosciences12@gmail.com',
    role: 'sales',
    accountName: 'Ram Ji Shukla - 6 (6abceacb44b44323)',
    companyId: '6abceacb44b44323',
    did: '07316917216',
    outboundNumber: '+91 7316917216',
    mobileNumber: '9201896603'
  },
  {
    name: 'Eram Istiyaque',
    email: 'sales6.essential@gmail.com',
    role: 'sales',
    accountName: 'Ram Ji Shukla - 6 (6abceacb44b44323)',
    companyId: '6abceacb44b44323',
    did: '07316917216',
    outboundNumber: '+91 7316917216',
    mobileNumber: '9201896608'
  }
];

/**
 * Handle MyOperator Call Webhooks (Inbound & Outbound)
 */
const handleCallWebhook = async (req, res) => {
  try {
    const payload = { ...(req.query || {}), ...(req.body || {}) };
    console.log('[MyOperator Call Webhook Event]:', JSON.stringify(payload));

    const nestedData = payload.payload || payload.data || payload.details || {};
    const merged = { ...payload, ...nestedData };

    // Extract legs & leg information
    const legs = Array.isArray(merged.legs) ? merged.legs : (Array.isArray(payload.legs) ? payload.legs : (Array.isArray(nestedData.legs) ? nestedData.legs : []));
    const customerLeg = legs.find(l => l.type === 'customer' || (l.pickup_device === 'phone' && !l.agent && l.phone_number));
    const agentLeg = legs.find(l => l.type === 'agent' || l.agent);

    const rawEvent = (payload.event_type || payload.event || payload.type || req.headers['x-event'] || '').toString().toLowerCase();
    const rawStatus = (merged.status || firstLeg?.dial_status || merged.call_status || merged.state || '').toString().toLowerCase();
    const event = rawEvent || (rawStatus ? `call.${rawStatus}` : 'call.update');
    
    const callId = merged.ref_id ||
                   merged.client_ref_id ||
                   merged.unique_id ||
                   merged.call_id ||
                   merged.id ||
                   merged.session_id ||
                   merged.uuid ||
                   merged.uid ||
                   merged.reference_id ||
                   payload.session_id ||
                   payload.event_id;

    // Detect Inbound vs Outbound accurately
    const rawType = String(merged.type || merged.call_type || '').trim().toLowerCase();
    const rawDirection = String(merged.direction || payload.direction || payload.event_type || '').trim().toLowerCase();
    const eventString = String(merged.event || payload.event || rawEvent || '').trim().toLowerCase();

    const isExplicitInbound = rawDirection === 'incoming' ||
                              rawDirection === 'inbound' ||
                              rawDirection === 'in' ||
                              rawDirection === '1' ||
                              merged.direction === 1 ||
                              payload.direction === 1 ||
                              eventString === '1' ||
                              eventString.startsWith('inbound') ||
                              eventString === 'call.inbound' ||
                              eventString === 'incoming';

    const isExplicitOutbound = !isExplicitInbound && (
                               rawDirection === 'outgoing' ||
                               rawDirection === 'outbound' ||
                               rawDirection === 'out' ||
                               rawDirection === '2' ||
                               merged.direction === 2 ||
                               payload.direction === 2 ||
                               eventString === '2' ||
                               eventString.startsWith('outbound') ||
                               eventString.startsWith('outgoing') ||
                               eventString === 'call.outbound' ||
                               eventString.includes('c2c') ||
                               eventString.includes('obd') ||
                               rawType === 'outbound' ||
                               rawType === 'outgoing' ||
                               rawType === 'obd' ||
                               rawType === 'click2call' ||
                               rawType === 'c2c' ||
                               rawType === 'dialer' ||
                               rawType === '2' ||
                               merged.type === 2
    );

    const isInbound = isExplicitInbound || (!isExplicitOutbound && Boolean(merged.public_ivr_id && !merged.customer_number && !merged.destination_number && !customerLeg));

    // Extract DID / Virtual line
    const rawDid = String(
      merged.did ||
      merged.virtual_number ||
      merged.received_on ||
      merged.destination_number ||
      merged.receiver_number ||
      merged.company_number ||
      ''
    ).replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');

    // Extract Company ID (Account Identifier)
    const companyId = String(
      merged.company_id ||
      merged.company_uuid ||
      merged.companyId ||
      merged.acc_id ||
      payload.company_id ||
      ''
    ).trim();

    // Known sales agent numbers to prevent inverted caller assignment
    const KNOWN_AGENT_PHONES = ['9201896606', '9399022063', '9399022061', '9201896604'];

    // Extract Customer Phone (Caller for Inbound, Callee for Outbound)
    let rawCustomerPhone = '';
    if (customerLeg?.phone_number) {
      rawCustomerPhone = customerLeg.phone_number;
    } else if (payload.customer_identifier) {
      rawCustomerPhone = payload.customer_identifier;
    } else if (merged.customer_number) {
      rawCustomerPhone = merged.customer_number;
    } else if (isInbound) {
      rawCustomerPhone = merged.cli ||
                         merged.caller_id ||
                         merged.caller_number ||
                         merged.from ||
                         merged.caller ||
                         merged.source ||
                         merged.client_number ||
                         merged.contact_number ||
                         merged.phone ||
                         merged.number || '';
    } else {
      rawCustomerPhone = merged.destination_number ||
                         merged.client_number ||
                         merged.number ||
                         merged.phone ||
                         merged.to ||
                         merged.caller_number ||
                         merged.caller_id || '';
    }
    let customerPhone = String(rawCustomerPhone).replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');

    // Extract Agent Phone
    let rawAgentPhone = '';
    if (agentLeg?.agent?.contact || agentLeg?.phone_number) {
      rawAgentPhone = agentLeg.agent?.contact || agentLeg.phone_number;
    } else {
      rawAgentPhone = merged.agent_number ||
                      merged.user_number ||
                      firstLeg?.phone_number ||
                      firstLeg?.agent?.contact ||
                      merged.receiver_number ||
                      merged.agent_contact ||
                      merged.transfer_to ||
                      '';
    }
    let agentPhone = String(rawAgentPhone).replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');

    // Safety check: If customerPhone matches a sales agent, invert to correct party
    if (KNOWN_AGENT_PHONES.includes(customerPhone) && !agentPhone) {
      agentPhone = customerPhone;
      customerPhone = '';
    } else if (KNOWN_AGENT_PHONES.includes(customerPhone) && agentPhone && !KNOWN_AGENT_PHONES.includes(agentPhone)) {
      const temp = customerPhone;
      customerPhone = agentPhone;
      agentPhone = temp;
    }

    const duration = parseInt(merged.duration || merged.call_duration || merged.talk_time || merged.billsec || firstLeg?.talk_duration || 0, 10);
    const recordingUrl = merged.recording_url ||
                         merged.recording ||
                         merged.audio_url ||
                         merged.file_url ||
                         merged.url ||
                         merged.recording_filename ||
                         merged.filename ||
                         merged.download_url ||
                         null;
    const callSummary = merged.summary || merged.disposition || rawStatus || (isInbound ? 'Inbound Call' : 'Outbound Call');

    // Fast Idempotency Check: Drop duplicate webhook deliveries within 60s
    const idempotencyKey = `${callId || customerPhone}_${event}_${rawStatus}_${duration}`;
    if (callId && isDuplicateWebhook(idempotencyKey)) {
      console.log(`[MyOperator Webhook] Dropping duplicate webhook event: ${idempotencyKey}`);
      return res.json({ success: true, message: 'Duplicate webhook dropped' });
    }

    // Resolve Sales Agent from Telephony Registry
    let matchedAccount = null;
    if (companyId) {
      matchedAccount = TELEPHONY_ACCOUNTS.find(acc => acc.companyId === companyId);
    }
    if (!matchedAccount && rawDid) {
      matchedAccount = TELEPHONY_ACCOUNTS.find(acc => {
        const cleanAccDid = acc.did.replace(/\D/g, '').replace(/^0+/, '');
        return cleanAccDid === rawDid || rawDid.endsWith(cleanAccDid) || cleanAccDid.endsWith(rawDid);
      });
    }
    if (!matchedAccount && agentPhone) {
      matchedAccount = TELEPHONY_ACCOUNTS.find(acc => acc.mobileNumber.includes(agentPhone) || agentPhone.includes(acc.mobileNumber));
    }

    let agentUser = null;
    if (matchedAccount) {
      agentUser = await User.findOne({ email: matchedAccount.email.toLowerCase() });
    }
    if (!agentUser && agentPhone) {
      agentUser = await User.findOne({ phoneNumber: { $regex: agentPhone } });
    }
    if (!agentUser && rawDid) {
      agentUser = await User.findOne({
        $or: [
          { 'myoperatorConfig.did': rawDid },
          { 'myoperatorConfig.did': `0${rawDid}` },
          { 'myoperatorConfig.did': `91${rawDid}` }
        ]
      });
    }

    const resolvedAgentId = agentUser ? agentUser._id : null;
    const resolvedAgentPhone = agentUser?.phoneNumber || matchedAccount?.mobileNumber || agentPhone;

    const isProgressOrRinging = ['initiated', 'ringing', 'dialing', 'progress', 'queued', 'connecting'].includes(rawStatus) ||
                                event.includes('initiat') || event.includes('ring') || event.includes('dial') || event.includes('progress') ||
                                event === 'call.dial_begin';

    const isAnsweredEvent = !isProgressOrRinging && (
      event === 'call.answered' || event === 'answered' || rawStatus === 'answered' || rawStatus === 'connected' || event.includes('connect')
    );

    const isEndEvent = !isProgressOrRinging && !isAnsweredEvent && (
      event.includes('end') ||
      event.includes('summary') ||
      event.includes('hung') ||
      event.includes('hangup') ||
      event.includes('disconnect') ||
      event.includes('complet') ||
      ['completed', 'ended', 'missed', 'busy', 'failed', 'no-answer', 'rejected', 'canceled', 'cancelled', 'disconnected', 'not_answered'].includes(rawStatus) ||
      !!recordingUrl
    );

    const uniqueIdFromAddParams = Array.isArray(merged.additional_parameters)
      ? merged.additional_parameters.find(p => p.ky === 'unique_id')?.vl
      : null;

    if (callId || customerPhone) {
      let callLog = null;

      // 1. Try finding by call ID / providerCallId / reference_id / unique_id / ref_id / additional_parameters
      const idsToMatch = [
        callId,
        uniqueIdFromAddParams,
        merged.ref_id,
        merged.client_ref_id,
        payload.session_id,
        merged.id,
        merged.unique_id,
        merged.allcaller_id,
        merged.call_id,
        merged.reference_id,
        ...(Array.isArray(merged.additional_parameters) ? merged.additional_parameters.map(p => p.vl) : [])
      ].filter(Boolean).map(String);

      if (idsToMatch.length > 0) {
        callLog = await CallLog.findOne({
          $or: [
            { callId: { $in: idsToMatch } },
            { providerCallId: { $in: idsToMatch } },
            { 'metadata.unique_id': { $in: idsToMatch } },
            { 'metadata.uid': { $in: idsToMatch } },
            { 'metadata.ref_id': { $in: idsToMatch } },
            { 'metadata.client_ref_id': { $in: idsToMatch } },
            { 'metadata.reference_id': { $in: idsToMatch } },
            { 'metadata.session_id': { $in: idsToMatch } },
            { 'metadata.call_id': { $in: idsToMatch } },
            { 'metadata.allcaller_id': { $in: idsToMatch } },
            { 'metadata.additional_parameters.vl': { $in: idsToMatch } },
            { 'metadata.additional_parameters': { $elemMatch: { ky: 'unique_id', vl: { $in: idsToMatch } } } }
          ]
        }).sort({ createdAt: -1 });
      }

      // 2. Fallback: match most recent call log for this customer phone & direction within 2 minutes
      if (!callLog && customerPhone) {
        const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
        callLog = await CallLog.findOne({
          customerPhone: { $regex: customerPhone },
          direction: isInbound ? 'inbound' : 'outbound',
          createdAt: { $gte: twoMinAgo }
        }).sort({ createdAt: -1 });
      }

      if (!callLog) {
        const contact = await Contact.findOne({
          $or: [
            { phone: customerPhone },
            { phone: `91${customerPhone}` },
            { phone: `+91${customerPhone}` },
            { phone: `0${customerPhone}` }
          ]
        });

        callLog = new CallLog({
          callId: String(callId || `CALL_${Date.now()}`),
          providerCallId: String(callId || `CALL_${Date.now()}`),
          direction: isInbound ? 'inbound' : 'outbound',
          customerPhone: customerPhone || 'Unknown',
          agentPhone: resolvedAgentPhone,
          agentId: resolvedAgentId,
          contactId: contact?._id || null,
          status: 'initiated'
        });
      }

      // Correct customerPhone if previously assigned to an agent's phone
      if (customerPhone && customerPhone !== 'Unknown' && (KNOWN_AGENT_PHONES.includes(callLog.customerPhone) || callLog.customerPhone === callLog.agentPhone || !callLog.customerPhone)) {
        callLog.customerPhone = customerPhone;
        callLog.contactId = null; // Reset to re-link to true customer contact
      }

      // Ensure agentId & agentPhone are populated
      if ((!callLog.agentId || KNOWN_AGENT_PHONES.includes(callLog.customerPhone)) && resolvedAgentId) {
        callLog.agentId = resolvedAgentId;
      }
      if ((!callLog.agentPhone || KNOWN_AGENT_PHONES.includes(callLog.customerPhone)) && resolvedAgentPhone) {
        callLog.agentPhone = resolvedAgentPhone;
      }
      if (!callLog.direction) {
        callLog.direction = isInbound ? 'inbound' : 'outbound';
      } else if (isExplicitOutbound) {
        callLog.direction = 'outbound';
      } else if (isExplicitInbound && callLog.direction !== 'outbound') {
        callLog.direction = 'inbound';
      }

      // Populate Contact details for real-time display & auto-linking
      let contactObj = null;
      if (callLog.contactId) {
        contactObj = await Contact.findById(callLog.contactId).select('name phone preferredLanguage').lean();
      } else if (customerPhone) {
        contactObj = await Contact.findOne({
          $or: [
            { phone: customerPhone },
            { phone: `91${customerPhone}` },
            { phone: `+91${customerPhone}` },
            { phone: `0${customerPhone}` }
          ]
        }).select('name phone preferredLanguage').lean();

        // If contact doesn't exist yet, check User (Lead/Dealer) first, or auto-create in CRM
        if (!contactObj && customerPhone && customerPhone.length >= 10) {
          try {
            const clean10 = customerPhone.replace(/\D/g, '').replace(/^91/, '');
            const existingUser = await User.findOne({
              $or: [
                { phoneNumber: clean10 },
                { phoneNumber: `91${clean10}` },
                { phoneNumber: `+91${clean10}` }
              ]
            }).lean();

            const computedName = existingUser
              ? `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() || existingUser.shopName || `Caller +91 ${clean10}`
              : `Caller +91 ${clean10}`;

            const newContact = await Contact.create({
              name: computedName,
              phone: `91${clean10}`,
              assignedTo: resolvedAgentId || existingUser?.assignedAgent || null,
              tags: existingUser ? ['lead'] : []
            });
            contactObj = { _id: newContact._id, name: newContact.name, phone: newContact.phone };
          } catch (_) {
            const clean10 = customerPhone.replace(/\D/g, '').replace(/^91/, '');
            contactObj = await Contact.findOne({
              $or: [{ phone: clean10 }, { phone: `91${clean10}` }, { phone: `+91${clean10}` }]
            }).select('name phone preferredLanguage').lean();
          }
        }

        if (contactObj) callLog.contactId = contactObj._id;
      }

      if (isProgressOrRinging) {
        if (callLog.status !== 'answered') {
          callLog.status = 'initiated';
        }
      } else if (isAnsweredEvent) {
        callLog.status = 'answered';
      } else if (isEndEvent) {
        callLog.status = duration > 0 ? 'answered' : (rawStatus === 'busy' ? 'busy' : (rawStatus === 'missed' || rawStatus === 'no-answer' || rawStatus === 'not_answered' ? 'missed' : 'ended'));
        if (duration > 0 || !callLog.durationSeconds) callLog.durationSeconds = duration;
        if (recordingUrl && (!callLog.recordingUrl || !callLog.recordingUrl.includes('amazonaws.com'))) callLog.recordingUrl = recordingUrl;
        callLog.callSummary = callSummary;
      } else if (rawStatus) {
        callLog.status = rawStatus;
      }

      callLog.metadata = { ...callLog.metadata, ...payload, ...nestedData, companyId, rawDid };
      if (recordingUrl && !callLog.recordingUrl) callLog.recordingUrl = recordingUrl;

      // Ultra-Fast Instant WebSocket Broadcast (< 1ms)
      const fastLogData = callLog.toObject();
      if (contactObj) {
        fastLogData.contactId = contactObj;
        fastLogData.customerName = contactObj.name;
      }
      if (agentUser) {
        fastLogData.agentId = {
          _id: agentUser._id,
          firstName: agentUser.firstName,
          lastName: agentUser.lastName,
          email: agentUser.email,
          phoneNumber: agentUser.phoneNumber
        };
      }

      const broadcastPayload = {
        type: 'CALL_UPDATE',
        event: isEndEvent ? 'call.ended' : event,
        isEnded: isEndEvent,
        data: {
          ...fastLogData,
          isEnded: isEndEvent,
          callEnded: isEndEvent,
          event: isEndEvent ? 'call.ended' : event
        }
      };

      if (callLog.agentId) {
        wsService.sendToUser(callLog.agentId.toString(), broadcastPayload);
      }
      wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);

      if (isEndEvent) {
        const endedPayload = {
          type: 'CALL_ENDED',
          data: {
            ...fastLogData,
            isEnded: true,
            callEnded: true
          }
        };
        if (callLog.agentId) wsService.sendToUser(callLog.agentId.toString(), endedPayload);
        wsService.broadcastToRoles(['admin', 'sales'], endedPayload);
      }

      // Persist to MongoDB asynchronously
      await callLog.save();
    }

    res.json({ success: true, message: 'Call webhook processed successfully' });
  } catch (error) {
    console.error('[MyOperator Call Webhook Error]:', error.message);
    res.status(200).json({ success: false, message: error.message });
  }
};

/**
 * Explicitly End an Active Call from Panel
 */
const endCall = async (req, res) => {
  try {
    const { callLogId, durationSeconds, customerPhone } = req.body;
    let callLog = null;
    if (callLogId) {
      callLog = await CallLog.findById(callLogId);
    }
    if (!callLog && customerPhone) {
      const cleanPhone = customerPhone.replace(/\D/g, '').replace(/^91/, '');
      callLog = await CallLog.findOne({ customerPhone: { $regex: cleanPhone } }).sort({ createdAt: -1 });
    }

    if (callLog) {
      if (durationSeconds !== undefined) {
        callLog.durationSeconds = parseInt(durationSeconds, 10) || callLog.durationSeconds || 0;
      }
      if (callLog.status === 'initiated' || callLog.status === 'dialing' || callLog.status === 'ringing') {
        callLog.status = callLog.durationSeconds > 0 ? 'answered' : 'ended';
      }
      await callLog.save();

      // Trigger telecom switch hangup on MyOperator
      const agentUser = callLog.agentId ? await User.findById(callLog.agentId) : null;
      const agentConfig = agentUser?.myoperatorConfig || {};
      const cid = callLog.providerCallId || callLog.callId || callLog.metadata?.call_id || callLog.metadata?.reference_id;

      if (cid) {
        myoperatorCallService.hangupCall({
          providerCallId: cid,
          callId: cid,
          referenceId: callLog.metadata?.reference_id,
          apiKey: agentConfig.callingXApiKey || agentConfig.apiKey,
          secretKey: agentConfig.callingSecretKey || agentConfig.secretKey,
          token: agentConfig.callingToken || agentConfig.token,
          agentPhone: callLog.agentPhone,
          companyId: agentConfig.companyId
        }).catch(err => console.error('[MyOperator Hangup Error]:', err.message));
      }

      const populatedLog = await CallLog.findById(callLog._id)
        .populate('agentId', 'firstName lastName')
        .populate('contactId', 'name phone');

      const logData = populatedLog ? populatedLog.toObject() : callLog.toObject();
      const broadcastPayload = {
        type: 'CALL_UPDATE',
        event: 'call.ended',
        isEnded: true,
        data: {
          ...logData,
          isEnded: true,
          callEnded: true,
          event: 'call.ended'
        }
      };

      if (callLog.agentId) {
        wsService.sendToUser(callLog.agentId.toString(), broadcastPayload);
      }
      wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);

      const endedPayload = {
        type: 'CALL_ENDED',
        data: { ...logData, isEnded: true, callEnded: true }
      };
      if (callLog.agentId) wsService.sendToUser(callLog.agentId.toString(), endedPayload);
      wsService.broadcastToRoles(['admin', 'sales'], endedPayload);
    }

    res.json({ success: true, message: 'Call ended successfully', data: callLog });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Generate / retrieve WebRTC credentials for in-browser calling
 */
const getWebRTCSession = async (req, res) => {
  try {
    const agentUser = await User.findById(req.user.id);
    const session = await myoperatorCallService.generateWebRTCSession({
      agentId: req.user.id,
      agentExtension: agentUser?.extension || '101',
      agentNumber: agentUser?.phoneNumber || ''
    });
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get direct playback URL for a call recording
 */
const getRecordingPlaybackUrl = async (req, res) => {
  try {
    const { callId } = req.params;
    let recordingUrl = null;

    let callLog = null;
    if (mongoose.Types.ObjectId.isValid(callId)) {
      callLog = await CallLog.findById(callId);
    }
    if (!callLog) {
      callLog = await CallLog.findOne({ $or: [{ callId }, { providerCallId: callId }] });
    }

    if (!callLog) {
      return res.status(404).json({ success: false, message: 'Call log not found or recording unavailable' });
    }

    // Role Security: Sales agents are strictly authorized ONLY for their own calls
    if (req.user.role === 'sales') {
      const agentUser = await User.findById(req.user.id);
      const agentPhoneDigits = agentUser?.phoneNumber
        ? agentUser.phoneNumber.replace(/\D/g, '').replace(/^91/, '')
        : '';
      const isMyCall =
        (callLog.agentId && callLog.agentId.toString() === req.user.id.toString()) ||
        (agentPhoneDigits && callLog.agentPhone && callLog.agentPhone.replace(/\D/g, '').includes(agentPhoneDigits));

      if (!isMyCall) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You are only authorized to listen to your own call recordings.'
        });
      }
    }

    // If callLog already has a direct playable S3 link, use it immediately
    if (callLog && callLog.recordingUrl && (callLog.recordingUrl.includes('amazonaws.com') || callLog.recordingUrl.includes('s3.'))) {
      recordingUrl = callLog.recordingUrl;
    } else {
      // Resolve direct S3 CDN stream URL from MyOperator recordings switch
      recordingUrl = await myoperatorCallService.getRecordingUrl(callLog || callId);
      if (recordingUrl && callLog) {
        callLog.recordingUrl = recordingUrl;
        await callLog.save();
      } else if (callLog && callLog.recordingUrl && (callLog.recordingUrl.includes('amazonaws.com') || callLog.recordingUrl.includes('s3.'))) {
        recordingUrl = callLog.recordingUrl;
      }
    }

    if (!recordingUrl || (!recordingUrl.includes('amazonaws.com') && !recordingUrl.includes('s3.') && !recordingUrl.endsWith('.mp3'))) {
      return res.status(404).json({
        success: false,
        message: 'Recording audio is currently being processed by MyOperator. Please try again in a few moments.'
      });
    }

    res.json({ success: true, data: { recordingUrl } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Toggle agent availability for receiving calls
 */
const setAgentStatus = async (req, res) => {
  try {
    const { receiveCalls } = req.body;
    const agentUser = await User.findById(req.user.id);
    if (!agentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    agentUser.isAvailableForCalls = receiveCalls !== false;
    await agentUser.save();

    await myoperatorCallService.setAgentCallAvailability({
      agentId: agentUser._id,
      receiveCalls: agentUser.isAvailableForCalls ? 1 : 0
    });

    res.json({
      success: true,
      message: `Agent availability updated to ${agentUser.isAvailableForCalls ? 'Online' : 'Offline'}`,
      data: { isAvailableForCalls: agentUser.isAvailableForCalls }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get Telephony Configured Agents List (Exact MyOperator lines)
 */
const getTelephonyAgents = async (req, res) => {
  try {
    const emails = TELEPHONY_ACCOUNTS.map(a => a.email.toLowerCase());
    const phones = TELEPHONY_ACCOUNTS.map(a => a.mobileNumber);

    const userDocs = await User.find({
      $or: [
        { email: { $in: emails } },
        { phoneNumber: { $in: phones } }
      ]
    }).select('_id firstName lastName email phoneNumber role').lean();

    const merged = TELEPHONY_ACCOUNTS.map(acc => {
      const match = userDocs.find(u => 
        (u.email && u.email.toLowerCase() === acc.email.toLowerCase()) ||
        (u.phoneNumber && u.phoneNumber.includes(acc.mobileNumber))
      );
      return {
        _id: match?._id ? match._id.toString() : null,
        firstName: acc.name,
        lastName: '',
        name: acc.name,
        email: acc.email,
        phoneNumber: acc.outboundNumber,
        mobileNumber: acc.mobileNumber,
        accountName: acc.accountName,
        companyId: acc.companyId,
        did: acc.did,
        role: acc.role,
        isAdmin: !!acc.isAdmin
      };
    });

    res.json({
      success: true,
      count: merged.length,
      agents: merged,
      data: merged
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Delete a single call log (Admin Only - Soft or Permanent)
 */
const deleteCallLog = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Only Administrators have permission to delete call logs.'
      });
    }

    const { id } = req.params;
    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.$or = [{ callId: id }, { providerCallId: id }];
    }

    const log = await CallLog.findOne(query);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Call log not found' });
    }

    if (isPermanent) {
      await CallLog.deleteOne({ _id: log._id });
    } else {
      log.isDeleted = true;
      log.deletedAt = new Date();
      log.deletedBy = req.user.id;
      await log.save();
    }

    // Broadcast deletion via WebSocket
    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CALL_DELETED',
      data: { id: log._id.toString() }
    });

    res.json({ success: true, message: isPermanent ? 'Call log permanently deleted' : 'Call log deleted successfully', id: log._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Restore a soft-deleted call log (Admin Only)
 */
const restoreCallLog = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Only Administrators have permission to restore call logs.'
      });
    }

    const { id } = req.params;
    let query = {};
    if (mongoose.Types.ObjectId.isValid(id)) {
      query._id = id;
    } else {
      query.$or = [{ callId: id }, { providerCallId: id }];
    }

    const log = await CallLog.findOne(query);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Call log not found' });
    }

    log.isDeleted = false;
    log.deletedAt = null;
    log.deletedBy = null;
    await log.save();

    const populated = await CallLog.findById(log._id)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('contactId', 'name phone preferredLanguage');

    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CALL_RESTORED',
      data: populated || log.toObject()
    });

    res.json({ success: true, message: 'Call log restored successfully', data: log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Bulk delete call logs (Admin Only - Soft or Permanent)
 */
const bulkDeleteCallLogs = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Only Administrators have permission to delete call logs.'
      });
    }

    const rawIds = req.body.ids || req.body.callLogIds;
    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of call log ids is required' });
    }
    const ids = rawIds.map(String);
    const objectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
    const filterQuery = {
      $or: [
        { _id: { $in: objectIds } },
        { callId: { $in: ids } },
        { providerCallId: { $in: ids } }
      ]
    };

    let deletedCount = 0;
    if (isPermanent) {
      const result = await CallLog.deleteMany(filterQuery);
      deletedCount = result.deletedCount;
    } else {
      const result = await CallLog.updateMany(
        filterQuery,
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: req.user.id
          }
        }
      );
      deletedCount = result.modifiedCount;
    }

    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CALLS_BULK_DELETED',
      data: { ids, count: deletedCount }
    });

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} call logs`,
      deletedCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Clear All Call Logs (Admin Only - Soft or Permanent)
 */
const clearAllCallLogs = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Only Administrators have permission to clear call logs.'
      });
    }

    const isPermanent = req.query.permanent === 'true' || req.body?.permanent === true;
    let deletedCount = 0;

    if (isPermanent) {
      const result = await CallLog.deleteMany({});
      deletedCount = result.deletedCount;
    } else {
      const result = await CallLog.updateMany(
        { isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: req.user.id
          }
        }
      );
      deletedCount = result.modifiedCount;
    }

    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CALLS_CLEARED',
      data: { count: deletedCount }
    });

    res.json({
      success: true,
      message: `Successfully cleared ${deletedCount} call logs`,
      deletedCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/**
 * Industrial CSV Export for Telephony:
 * reportType = 'agent_summary' -> 1 row per agent for the selected date
 * reportType = 'all_calls'     -> All raw call detail records (up to 10k)
 */
const exportCallLogs = async (req, res) => {
  try {
    const {
      reportType = 'agent_summary',
      date,
      startDate,
      endDate,
      timeframe,
      agentId,
      type,
      status,
      search
    } = req.query;

    const dateRange = resolveDateRange({ date, startDate, endDate, timeframe });
    let metricsMatch = { isDeleted: { $ne: true } };

    if (dateRange && dateRange.start && dateRange.end) {
      metricsMatch.createdAt = { $gte: dateRange.start, $lte: dateRange.end };
    }

    if (req.user.role === 'sales') {
      metricsMatch.agentId = new mongoose.Types.ObjectId(req.user.id);
    } else if (agentId && agentId !== 'all' && mongoose.Types.ObjectId.isValid(agentId)) {
      metricsMatch.agentId = new mongoose.Types.ObjectId(agentId);
    }

    const formatDuration = (secs) => {
      if (!secs || secs <= 0) return '0s';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    };

    const formatIst = (d) => {
      if (!d) return 'N/A';
      try {
        return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
      } catch (_) {
        return String(d);
      }
    };

    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    if (reportType === 'agent_summary') {
      const summaryList = await CallLog.aggregate([
        { $match: { ...metricsMatch, agentId: { $ne: null } } },
        {
          $group: {
            _id: '$agentId',
            totalCalls: { $sum: 1 },
            talkTimeSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } },
            answeredCalls: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ['$status', 'answered'] }, { $gt: ['$durationSeconds', 0] }] },
                  1,
                  0
                ]
              }
            },
            outboundCalls: {
              $sum: {
                $cond: [
                  { $in: ['$direction', ['outbound']] },
                  1,
                  { $cond: [{ $eq: ['$type', 'outbound'] }, 1, 0] }
                ]
              }
            },
            inboundCalls: {
              $sum: {
                $cond: [
                  { $in: ['$direction', ['inbound']] },
                  1,
                  { $cond: [{ $eq: ['$type', 'inbound'] }, 1, 0] }
                ]
              }
            },
            missedCalls: {
              $sum: { $cond: [{ $in: ['$status', ['missed', 'no-answer']] }, 1, 0] }
            },
            firstCallAt: { $min: '$createdAt' },
            lastCallAt: { $max: '$createdAt' },
            uniqueCustomers: { $addToSet: '$customerPhone' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'agent'
          }
        },
        { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            agentName: {
              $trim: {
                input: {
                  $concat: [{ $ifNull: ['$agent.firstName', ''] }, ' ', { $ifNull: ['$agent.lastName', ''] }]
                }
              }
            },
            agentEmail: { $ifNull: ['$agent.email', ''] },
            agentPhone: { $ifNull: ['$agent.phoneNumber', ''] },
            totalCalls: 1,
            outboundCalls: 1,
            inboundCalls: 1,
            answeredCalls: 1,
            missedCalls: 1,
            talkTimeSeconds: 1,
            firstCallAt: 1,
            lastCallAt: 1,
            uniqueCustomersCount: { $size: '$uniqueCustomers' }
          }
        },
        { $sort: { talkTimeSeconds: -1, totalCalls: -1 } }
      ]);

      const headers = [
        'Agent Name',
        'Phone Number',
        'Email',
        'Total Calls',
        'Outbound Dials',
        'Inbound Calls',
        'Answered Calls',
        'Missed / Unanswered',
        'Answer Rate %',
        'Total Talk Time',
        'Avg Handle Time (AHT)',
        'Shift First Call (IST)',
        'Shift Last Call (IST)',
        'Unique Leads Contacted'
      ];

      const rows = summaryList.map(a => {
        const ansRate = a.totalCalls > 0 ? ((a.answeredCalls / a.totalCalls) * 100).toFixed(1) + '%' : '0%';
        const aht = a.answeredCalls > 0 ? Math.round(a.talkTimeSeconds / a.answeredCalls) + 's' : '0s';
        return [
          escapeCsv(a.agentName || 'Agent'),
          escapeCsv(a.agentPhone),
          escapeCsv(a.agentEmail),
          a.totalCalls,
          a.outboundCalls,
          a.inboundCalls,
          a.answeredCalls,
          a.missedCalls,
          escapeCsv(ansRate),
          escapeCsv(formatDuration(a.talkTimeSeconds)),
          escapeCsv(aht),
          escapeCsv(formatIst(a.firstCallAt)),
          escapeCsv(formatIst(a.lastCallAt)),
          a.uniqueCustomersCount
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');
      const filename = `sales_agents_daily_report_${(date || timeframe || 'summary').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    }

    // Default: Export All Raw Call Detail Records for the date
    const andConditions = [{ isDeleted: { $ne: true } }];
    if (dateRange && dateRange.start && dateRange.end) {
      andConditions.push({ createdAt: { $gte: dateRange.start, $lte: dateRange.end } });
    }
    if (req.user.role === 'sales') {
      andConditions.push({ agentId: req.user.id });
    } else if (agentId && agentId !== 'all' && mongoose.Types.ObjectId.isValid(agentId)) {
      andConditions.push({ agentId });
    }
    if (type && type !== 'all') {
      andConditions.push({ $or: [{ direction: type }, { type: type }] });
    }
    if (status && status !== 'all') {
      if (status === 'missed') andConditions.push({ status: { $in: ['missed', 'no-answer'] } });
      else if (status === 'answered') andConditions.push({ $or: [{ status: 'answered' }, { durationSeconds: { $gt: 0 } }] });
      else andConditions.push({ status });
    }

    const logs = await CallLog.find({ $and: andConditions })
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('contactId', 'name phone')
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();

    const cdrHeaders = [
      'Call Date & Time (IST)',
      'Direction',
      'Customer Phone',
      'Customer Name',
      'Sales Agent Name',
      'Sales Agent Phone',
      'Call Status',
      'Duration (Mins:Secs)',
      'Duration (Seconds)',
      'Outcome Disposition',
      'Follow Up Date',
      'Agent Notes',
      'Recording URL'
    ];

    const cdrRows = logs.map(l => {
      const agentName = l.agentId ? `${l.agentId.firstName || ''} ${l.agentId.lastName || ''}`.trim() : (l.agentPhone || 'Unassigned');
      const contactName = l.contactId?.name || '';
      return [
        escapeCsv(formatIst(l.createdAt)),
        escapeCsv(l.direction || l.type || 'outbound'),
        escapeCsv(l.customerPhone),
        escapeCsv(contactName),
        escapeCsv(agentName),
        escapeCsv(l.agentPhone || l.agentId?.phoneNumber || ''),
        escapeCsv(l.status),
        escapeCsv(formatDuration(l.durationSeconds)),
        l.durationSeconds || 0,
        escapeCsv(l.userDisposition || l.disposition || ''),
        escapeCsv(formatIst(l.followUpDate)),
        escapeCsv((l.notes || l.callSummary || '').replace(/\n/g, ' ')),
        escapeCsv(l.recordingUrl || '')
      ].join(',');
    });

    const csvContent = [cdrHeaders.join(','), ...cdrRows].join('\n');
    const filename = `call_records_${(date || timeframe || 'export').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// FOLLOW-UP TRACKER
// A follow-up is PENDING when:
//   • it is the most recent scheduled follow-up for that customer (older ones are superseded),
//   • it was not manually closed (followUpCompletedAt == null), and
//   • no ANSWERED call to the same customer happened after it was scheduled (auto-resolved).
// Buckets (IST): overdue = due time already passed, today = due later today, upcoming = after today.
// ═════════════════════════════════════════════════════════════════════════════

async function buildSalesAgentScope(userId) {
  const agentUser = await User.findById(userId).lean();
  const scope = [{ agentId: new mongoose.Types.ObjectId(userId) }];
  const phoneDigits = agentUser?.phoneNumber ? agentUser.phoneNumber.replace(/\D/g, '').replace(/^91/, '') : '';
  if (phoneDigits) scope.push({ agentPhone: { $regex: phoneDigits } });
  return scope;
}

function istEndOfToday() {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const ymd = istNow.toISOString().slice(0, 10);
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

const getFollowUps = async (req, res) => {
  try {
    const { agentId, bucket = 'all', limit = 200 } = req.query;
    const now = new Date();
    const endOfToday = istEndOfToday();

    const match = {
      isDeleted: { $ne: true },
      followUpDate: { $ne: null },
      followUpCompletedAt: null
    };

    // Role security: sales agents only see their own follow-ups
    if (req.user.role === 'sales') {
      match.$or = await buildSalesAgentScope(req.user.id);
    } else if (agentId && agentId !== 'all' && mongoose.Types.ObjectId.isValid(agentId)) {
      match.agentId = new mongoose.Types.ObjectId(agentId);
    }

    const itemsMatch = ['overdue', 'today', 'upcoming'].includes(bucket) ? { bucket } : {};

    const [result] = await CallLog.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          phoneKey: {
            $let: {
              vars: { p: { $ifNull: ['$customerPhone', ''] } },
              in: {
                $substrCP: [
                  '$$p',
                  { $max: [0, { $subtract: [{ $strLenCP: '$$p' }, 10] }] },
                  10
                ]
              }
            }
          }
        }
      },
      // Keep only the latest scheduled follow-up per customer
      { $group: { _id: '$phoneKey', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      // Auto-resolve: was there an answered call to this customer after it was scheduled?
      {
        $lookup: {
          from: CallLog.collection.name,
          let: { phone: '$customerPhone', key: '$phoneKey', scheduledAt: '$updatedAt' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $in: ['$customerPhone', [
                        '$$phone',
                        '$$key',
                        { $concat: ['91', '$$key'] },
                        { $concat: ['+91', '$$key'] },
                        { $concat: ['0', '$$key'] }
                      ]]
                    },
                    { $gt: ['$createdAt', '$$scheduledAt'] },
                    { $ne: ['$isDeleted', true] },
                    { $or: [{ $eq: ['$status', 'answered'] }, { $gt: ['$durationSeconds', 0] }] }
                  ]
                }
              }
            },
            { $limit: 1 },
            { $project: { _id: 1 } }
          ],
          as: 'resolvedBy'
        }
      },
      { $match: { resolvedBy: { $size: 0 } } },
      {
        $addFields: {
          bucket: {
            $switch: {
              branches: [
                { case: { $lt: ['$followUpDate', now] }, then: 'overdue' },
                { case: { $lte: ['$followUpDate', endOfToday] }, then: 'today' }
              ],
              default: 'upcoming'
            }
          }
        }
      },
      {
        $facet: {
          counts: [{ $group: { _id: '$bucket', count: { $sum: 1 } } }],
          byAgent: [
            {
              $group: {
                _id: '$agentId',
                overdue: { $sum: { $cond: [{ $eq: ['$bucket', 'overdue'] }, 1, 0] } },
                today: { $sum: { $cond: [{ $eq: ['$bucket', 'today'] }, 1, 0] } },
                upcoming: { $sum: { $cond: [{ $eq: ['$bucket', 'upcoming'] }, 1, 0] } }
              }
            },
            { $lookup: { from: User.collection.name, localField: '_id', foreignField: '_id', as: 'agent' } },
            {
              $project: {
                agentId: '$_id',
                _id: 0,
                overdue: 1,
                today: 1,
                upcoming: 1,
                agentName: {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: [{ $arrayElemAt: ['$agent.firstName', 0] }, 'Unassigned'] },
                        ' ',
                        { $ifNull: [{ $arrayElemAt: ['$agent.lastName', 0] }, ''] }
                      ]
                    }
                  }
                }
              }
            },
            { $sort: { overdue: -1, today: -1 } }
          ],
          items: [
            { $match: itemsMatch },
            { $sort: { followUpDate: 1 } },
            { $limit: Math.min(parseInt(limit) || 200, 500) },
            { $lookup: { from: Contact.collection.name, localField: 'contactId', foreignField: '_id', as: 'contact' } },
            { $lookup: { from: User.collection.name, localField: 'agentId', foreignField: '_id', as: 'agent' } },
            {
              $project: {
                _id: 1,
                customerPhone: 1,
                followUpDate: 1,
                followUpNote: 1,
                userDisposition: 1,
                notes: 1,
                status: 1,
                createdAt: 1,
                bucket: 1,
                contactName: { $arrayElemAt: ['$contact.name', 0] },
                agentId: 1,
                agentName: {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: [{ $arrayElemAt: ['$agent.firstName', 0] }, ''] },
                        ' ',
                        { $ifNull: [{ $arrayElemAt: ['$agent.lastName', 0] }, ''] }
                      ]
                    }
                  }
                }
              }
            }
          ]
        }
      }
    ]);

    const counts = { overdue: 0, today: 0, upcoming: 0 };
    (result?.counts || []).forEach((c) => { counts[c._id] = c.count; });

    res.json({
      success: true,
      data: {
        summary: { ...counts, total: counts.overdue + counts.today + counts.upcoming },
        byAgent: result?.byAgent || [],
        items: result?.items || []
      }
    });
  } catch (error) {
    console.error('[getFollowUps] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const completeFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid call log ID' });
    }
    const callLog = await CallLog.findById(id);
    if (!callLog || callLog.isDeleted) {
      return res.status(404).json({ success: false, message: 'Call log not found' });
    }
    if (req.user.role === 'sales' && (!callLog.agentId || callLog.agentId.toString() !== req.user.id.toString())) {
      return res.status(403).json({ success: false, message: 'Access Denied: You can only close your own follow-ups.' });
    }

    callLog.followUpCompletedAt = new Date();
    callLog.followUpCompletedBy = req.user.id;
    await callLog.save();

    res.json({ success: true, message: 'Follow-up marked as done', data: { _id: callLog._id } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  triggerOutboundCall,
  getCallLogs,
  exportCallLogs,
  syncCallLogs,
  saveCallDisposition,
  handleCallWebhook,
  endCall,
  getWebRTCSession,
  getRecordingPlaybackUrl,
  setAgentStatus,
  getTelephonyAgents,
  deleteCallLog,
  restoreCallLog,
  bulkDeleteCallLogs,
  clearAllCallLogs,
  getFollowUps,
  completeFollowUp
};
