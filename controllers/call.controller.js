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
 * Fetch Call Logs with Aggregated Telephony Metrics & Leaderboards
 */
const getCallLogs = async (req, res) => {
  try {
    const { search, customerPhone, agentId, type, status, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};

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
      query.status = status.toLowerCase();
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

    const callLogs = await CallLog.find(query)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('contactId', 'name phone preferredLanguage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CallLog.countDocuments(query);

    // Enrich logs with contact lookup if contactId was unlinked
    const enrichedLogs = await Promise.all(callLogs.map(async (log) => {
      const logObj = log.toObject();
      if (!logObj.contactId && logObj.customerPhone) {
        const cleanPhone = logObj.customerPhone.replace(/\D/g, '').replace(/^91/, '');
        const contact = await Contact.findOne({
          $or: [
            { phone: cleanPhone },
            { phone: `91${cleanPhone}` },
            { phone: `+91${cleanPhone}` }
          ]
        }).select('name phone preferredLanguage').lean();
        if (contact) {
          logObj.contactId = contact;
        }
      }
      return logObj;
    }));

    // Compute metrics for Leaderboard & Telephony KPIs via high-performance MongoDB Aggregation
    const metricsMatch = req.user.role === 'sales' ? { agentId: new mongoose.Types.ObjectId(req.user.id) } : {};

    const [summaryResult, leaderboardResult] = await Promise.all([
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

    // Also sync notes to User profile if contact phone is known
    if (callLog.customerPhone && (notes || userDisposition)) {
      try {
        const cleanPhone = callLog.customerPhone.replace(/\D/g, '').replace(/^91/, '');
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

/**
 * Handle MyOperator Call Webhooks
 */
const handleCallWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[MyOperator Call Webhook Event]:', JSON.stringify(payload));

    const nestedData = payload.payload || payload.data || payload.details || {};
    const merged = { ...payload, ...nestedData };

    const firstLeg = (merged.legs && Array.isArray(merged.legs) && merged.legs.length > 0) ? merged.legs[0] : null;

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

    const customerPhone = (merged.customer_number ||
                           payload.customer_identifier ||
                           merged.caller_number ||
                           merged.client_number ||
                           merged.destination_number ||
                           merged.phone ||
                           merged.number || '').replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');

    const agentPhone = (merged.agent_number ||
                        firstLeg?.phone_number ||
                        firstLeg?.agent?.contact ||
                        merged.receiver_number ||
                        merged.user_number || '').replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');

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
    const callSummary = merged.summary || merged.disposition || rawStatus || 'Call Ended';

    // Fast Idempotency Check: Drop duplicate webhook deliveries within 60s
    const idempotencyKey = `${callId || customerPhone}_${event}_${rawStatus}_${duration}`;
    if (callId && isDuplicateWebhook(idempotencyKey)) {
      console.log(`[MyOperator Webhook] Dropping duplicate webhook event: ${idempotencyKey}`);
      return res.json({ success: true, message: 'Duplicate webhook dropped' });
    }

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

    if (callId || customerPhone) {
      let callLog = null;

      // 1. Try finding by call ID / providerCallId / reference_id / unique_id / ref_id
      if (callId || merged.ref_id || merged.client_ref_id) {
        const idsToMatch = [
          callId,
          merged.ref_id,
          merged.client_ref_id,
          payload.session_id,
          merged.id,
          merged.unique_id
        ].filter(Boolean).map(String);

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
            { 'metadata.call_id': { $in: idsToMatch } }
          ]
        }).sort({ createdAt: -1 });
      }

      // 2. Fallback: match most recent call log for this customer phone within last 2 hours
      if (!callLog && customerPhone) {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        callLog = await CallLog.findOne({
          customerPhone: { $regex: customerPhone },
          createdAt: { $gte: twoHoursAgo }
        }).sort({ createdAt: -1 });
      }

      if (!callLog) {
        let agentId = null;
        if (agentPhone) {
          const agentUser = await User.findOne({ phoneNumber: { $regex: agentPhone } });
          if (agentUser) agentId = agentUser._id;
        }

        const contact = await Contact.findOne({
          $or: [
            { phone: customerPhone },
            { phone: `91${customerPhone}` },
            { phone: `+91${customerPhone}` }
          ]
        });

        callLog = new CallLog({
          callId: String(callId || `CALL_${Date.now()}`),
          providerCallId: String(callId || `CALL_${Date.now()}`),
          direction: merged.direction === 'inbound' ? 'inbound' : 'outbound',
          customerPhone: customerPhone || 'Unknown',
          agentPhone,
          agentId,
          contactId: contact?._id || null,
          status: 'initiated'
        });
      }

      if (isProgressOrRinging) {
        if (callLog.status !== 'answered') {
          callLog.status = 'initiated';
        }
      } else if (isAnsweredEvent) {
        callLog.status = 'answered';
      } else if (isEndEvent) {
        callLog.status = duration > 0 ? 'answered' : (rawStatus === 'busy' ? 'busy' : (rawStatus === 'missed' ? 'missed' : 'ended'));
        if (duration > 0 || !callLog.durationSeconds) callLog.durationSeconds = duration;
        if (recordingUrl) callLog.recordingUrl = recordingUrl;
        callLog.callSummary = callSummary;
      } else if (rawStatus) {
        callLog.status = rawStatus;
      }

      callLog.metadata = { ...callLog.metadata, ...payload, ...nestedData };
      if (recordingUrl && !callLog.recordingUrl) callLog.recordingUrl = recordingUrl;

      // Ultra-Fast Instant WebSocket Broadcast (< 1ms)
      const fastLogData = callLog.toObject();
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
          secretKey: agentConfig.callingSecretKey || agentConfig.secretKey
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

module.exports = {
  triggerOutboundCall,
  getCallLogs,
  saveCallDisposition,
  handleCallWebhook,
  endCall,
  getWebRTCSession,
  getRecordingPlaybackUrl,
  setAgentStatus
};
