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

/**
 * Fetch Call Logs with Aggregated Telephony Metrics & Leaderboards
 */
const getCallLogs = async (req, res) => {
  try {
    // Proactively kick off sync in background
    triggerBackgroundSync();
    const { search, customerPhone, agentId, type, status, view, includeDeleted, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};

    // ── Industrial Soft Delete Filter ──────────────────────────────────────────
    if (view === 'trash' || view === 'deleted') {
      query.isDeleted = true;
    } else if (includeDeleted !== 'true') {
      query.isDeleted = { $ne: true };
    }

    // ── Multi-Field Search (Phone, Customer Name, Disposition, Notes) ────────
    const searchTerm = (search || customerPhone || '').trim();
    if (searchTerm !== '') {
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
        query.$or = searchConditions;
      }
    }

    if (agentId && agentId !== 'null' && agentId !== 'undefined' && agentId.trim() !== '') {
      query.agentId = agentId;
    }

    if (type && type !== 'all' && type.trim() !== '') {
      query.$or = [{ direction: type }, { type: type }];
    }

    if (status && status !== 'all' && status.trim() !== '') {
      const s = status.toLowerCase();
      if (s === 'missed') {
        query.status = { $in: ['missed', 'no-answer'] };
      } else if (s === 'answered') {
        query.$or = [{ status: 'answered' }, { durationSeconds: { $gt: 0 } }];
      } else {
        query.status = s;
      }
    }

    // Role Security: Sales agents see calls they made/received OR calls with contacts assigned to them
    if (req.user.role === 'sales') {
      const agentUser = await User.findById(req.user.id);
      const agentPhone = agentUser?.phoneNumber
        ? agentUser.phoneNumber.replace(/\D/g, '').replace(/^91/, '')
        : '';
      
      const assignedContactIds = await Contact.find({ assignedTo: req.user.id }).distinct('_id');

      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { agentId: req.user.id },
          ...(agentPhone ? [{ agentPhone: { $regex: agentPhone } }] : []),
          ...(assignedContactIds.length > 0 ? [{ contactId: { $in: assignedContactIds } }] : [])
        ]
      });
    }

    // Parallelize Primary Query, Count, KPI Metrics & Leaderboard
    const metricsMatch = req.user.role === 'sales'
      ? { agentId: new mongoose.Types.ObjectId(req.user.id), isDeleted: { $ne: true } }
      : { isDeleted: { $ne: true } };

    const [callLogs, total, summaryResult, leaderboardResult] = await Promise.all([
      CallLog.find(query)
        .populate('agentId', 'firstName lastName email phoneNumber')
        .populate('contactId', 'name phone preferredLanguage')
        .sort({ createdAt: -1 })
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
            missedCount: {
              $sum: {
                $cond: [{ $in: ['$status', ['missed', 'no-answer']] }, 1, 0]
              }
            },
            totalSeconds: { $sum: { $ifNull: ['$durationSeconds', 0] } }
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
              $sum: { $cond: [{ $eq: ['$status', 'answered'] }, 1, 0] }
            }
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
            totalCalls: 1,
            talkTimeSeconds: 1,
            answeredCalls: 1
          }
        },
        { $sort: { talkTimeSeconds: -1 } },
        { $limit: 25 }
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
      missedCount: 0,
      totalSeconds: 0
    };

    res.json({
      success: true,
      data: enrichedLogs,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
      metrics: {
        totalCalls: metricsSummary.totalCalls || 0,
        inboundCount: metricsSummary.inboundCount || 0,
        outboundCount: metricsSummary.outboundCount || 0,
        missedCount: metricsSummary.missedCount || 0,
        totalSeconds: metricsSummary.totalSeconds || 0,
        leaderboard: leaderboardResult || []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Save Post-Call Disposition & Schedule Follow-Up (Feature #1)
 */
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

    if (userDisposition) callLog.userDisposition = userDisposition;
    if (followUpDate) callLog.followUpDate = new Date(followUpDate);
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
    const KNOWN_AGENT_PHONES = ['9201896606', '9399022063', '9201896603', '9201896608', '9201896604'];

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

        // If contact doesn't exist yet, auto-create in CRM so it's immediately indexed
        if (!contactObj && customerPhone && customerPhone.length >= 10) {
          try {
            const newContact = await Contact.create({
              name: `Caller +91 ${customerPhone}`,
              phone: `+91${customerPhone}`,
              assignedTo: resolvedAgentId || null
            });
            contactObj = { _id: newContact._id, name: newContact.name, phone: newContact.phone };
          } catch (_) {
            contactObj = await Contact.findOne({
              $or: [{ phone: customerPhone }, { phone: `+91${customerPhone}` }]
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
        if (recordingUrl) callLog.recordingUrl = recordingUrl;
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

    if (callLog && callLog.recordingUrl) {
      recordingUrl = callLog.recordingUrl;
    } else {
      recordingUrl = await myoperatorCallService.getRecordingUrl(callLog || callId);
      if (recordingUrl && callLog) {
        callLog.recordingUrl = recordingUrl;
        await callLog.save();
      }
    }

    if (!recordingUrl) {
      return res.status(404).json({ success: false, message: 'Recording not ready or unavailable from MyOperator switch' });
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
 * Delete a single call log (Soft or Permanent)
 */
const deleteCallLog = async (req, res) => {
  try {
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

    // Role check: Only admin or the assigned agent can delete
    if (req.user.role !== 'admin' && log.agentId && log.agentId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this call log' });
    }

    if (isPermanent && req.user.role === 'admin') {
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
 * Restore a soft-deleted call log
 */
const restoreCallLog = async (req, res) => {
  try {
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
 * Bulk delete call logs (Soft or Permanent)
 */
const bulkDeleteCallLogs = async (req, res) => {
  try {
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
    if (isPermanent && req.user.role === 'admin') {
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
      return res.status(403).json({ success: false, message: 'Only Admins can clear all call logs' });
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

module.exports = {
  triggerOutboundCall,
  getCallLogs,
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
  clearAllCallLogs
};
