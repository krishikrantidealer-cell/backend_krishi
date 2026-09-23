const CallLog = require('../models/CallLog');
const Contact = require('../models/Contact');
const User = require('../models/User');
const myoperatorCallService = require('../services/myoperatorCall.service');
const wsService = require('../services/websocket.service');

/**
 * 1-Click Outbound Click-to-Call Trigger
 */
const triggerOutboundCall = async (req, res) => {
  try {
    const { customerPhone } = req.body;
    if (!customerPhone) {
      return res.status(400).json({ success: false, message: 'Customer phone number is required' });
    }

    const agentUser = await User.findById(req.user.id);
    const agentPhone = agentUser?.phoneNumber || '';

    const result = await myoperatorCallService.triggerOutboundCall({
      agentId: req.user.id,
      customerPhone,
      agentPhone
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
    const { customerPhone, agentId, type, status, page = 1, limit = 25 } = req.query;
    const skip = (page - 1) * limit;

    const query = {};

    if (customerPhone) {
      const cleanPhone = customerPhone.replace(/\D/g, '').replace(/^91/, '');
      query.customerPhone = { $regex: cleanPhone };
    }

    if (agentId) {
      query.agentId = agentId;
    }

    if (type && type !== 'all') {
      query.$or = [{ direction: type }, { type: type }];
    }

    if (status && status !== 'all') {
      query.status = status.toLowerCase();
    }

    // Role Security: Sales agents can ONLY see call logs for their assigned leads or calls made by them
    if (req.user.role === 'sales') {
      query.agentId = req.user.id;
    }

    const callLogs = await CallLog.find(query)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('contactId', 'name phone preferredLanguage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CallLog.countDocuments(query);

    // Compute metrics for Leaderboard & Telephony KPIs
    const allLogsForMetrics = await CallLog.find(req.user.role === 'sales' ? { agentId: req.user.id } : {})
      .select('direction type status durationSeconds agentId createdAt')
      .populate('agentId', 'firstName lastName');

    let totalCalls = allLogsForMetrics.length;
    let inboundCount = 0;
    let outboundCount = 0;
    let missedCount = 0;
    let totalSeconds = 0;

    const agentStatsMap = {};

    for (const log of allLogsForMetrics) {
      const dir = log.direction || log.type || 'outbound';
      if (dir === 'inbound') inboundCount++;
      else outboundCount++;

      if (log.status === 'missed' || log.status === 'no-answer') missedCount++;

      const dur = parseInt(log.durationSeconds || 0, 10);
      totalSeconds += dur;

      if (log.agentId) {
        const agId = log.agentId._id?.toString() || log.agentId.toString();
        const agName = `${log.agentId.firstName || ''} ${log.agentId.lastName || ''}`.trim() || 'Agent';
        if (!agentStatsMap[agId]) {
          agentStatsMap[agId] = {
            agentId: agId,
            agentName: agName,
            totalCalls: 0,
            talkTimeSeconds: 0,
            answeredCalls: 0
          };
        }
        agentStatsMap[agId].totalCalls++;
        agentStatsMap[agId].talkTimeSeconds += dur;
        if (log.status === 'answered') agentStatsMap[agId].answeredCalls++;
      }
    }

    const leaderboard = Object.values(agentStatsMap).sort((a, b) => b.talkTimeSeconds - a.talkTimeSeconds);

    res.json({
      success: true,
      data: callLogs,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) },
      metrics: {
        totalCalls,
        inboundCount,
        outboundCount,
        missedCount,
        totalSeconds,
        leaderboard
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
        
        user.notesHistory = user.notesHistory || [];
        user.notesHistory.push({
          title: `Call Disposition: ${userDisposition || 'Call Logged'}`,
          note: `${notes || ''} ${followUpNote ? `[Follow-up: ${followUpNote}]` : ''}`.trim(),
          adminId: req.user.id,
          adminName: authorName,
          author: authorName,
          createdAt: new Date(),
          type: 'call_disposition'
        });
        await user.save();
      }
    }

    res.json({
      success: true,
      message: 'Call disposition saved successfully',
      data: callLog
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Handle MyOperator Inbound Call Webhooks
 */
const handleCallWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[MyOperator Call Webhook Event]:', JSON.stringify(payload));

    const event = payload.event || payload.type || req.headers['x-event'] || 'call.summary';
    const callId = payload.call_id || payload.id || payload.uuid || payload.uid;
    const customerPhone = (payload.customer_number || payload.caller_number || payload.phone || '').replace(/\D/g, '').replace(/^91/, '');
    const agentPhone = (payload.agent_number || payload.receiver_number || '').replace(/\D/g, '').replace(/^91/, '');
    const duration = parseInt(payload.duration || payload.call_duration || payload.talk_time || 0, 10);
    const recordingUrl = payload.recording_url || payload.filename || payload.audio_url || null;
    const callSummary = payload.summary || payload.disposition || payload.status || 'Call Ended';

    if (callId || customerPhone) {
      let callLog = await CallLog.findOne({
        $or: [
          { callId: String(callId) },
          { providerCallId: String(callId) }
        ]
      });

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
          direction: payload.direction === 'inbound' ? 'inbound' : 'outbound',
          customerPhone: customerPhone || 'Unknown',
          agentPhone,
          agentId,
          contactId: contact?._id || null,
          status: 'initiated'
        });
      }

      const terminalStatuses = ['answered', 'ended', 'completed', 'missed', 'busy', 'failed'];
      const isAlreadyTerminal = terminalStatuses.includes(callLog.status) && (callLog.durationSeconds > 0 || callLog.recordingUrl);

      if (event === 'call.answered') {
        callLog.status = 'answered';
      } else if (event === 'call.end' || event === 'call.summary') {
        callLog.status = duration > 0 ? 'answered' : (payload.status === 'busy' ? 'busy' : 'missed');
        if (duration > 0 || !callLog.durationSeconds) callLog.durationSeconds = duration;
        if (recordingUrl) callLog.recordingUrl = recordingUrl;
        callLog.callSummary = callSummary;
      } else if (payload.status && !isAlreadyTerminal) {
        callLog.status = payload.status.toLowerCase();
      }

      callLog.metadata = { ...callLog.metadata, ...payload };
      await callLog.save();

      // Broadcast call update via WebSockets to CRM
      const populatedLog = await CallLog.findById(callLog._id)
        .populate('agentId', 'firstName lastName')
        .populate('contactId', 'name phone');
        
      const broadcastPayload = {
        type: 'CALL_UPDATE',
        data: populatedLog
      };

      if (callLog.agentId) {
        wsService.sendToUser(callLog.agentId.toString(), broadcastPayload);
      }
      wsService.broadcastToRoles(['admin'], broadcastPayload);
    }

    res.json({ success: true, message: 'Call webhook processed successfully' });
  } catch (error) {
    console.error('[MyOperator Call Webhook Error]:', error.message);
    res.status(200).json({ success: false, message: error.message });
  }
};

module.exports = {
  triggerOutboundCall,
  getCallLogs,
  saveCallDisposition,
  handleCallWebhook
};
