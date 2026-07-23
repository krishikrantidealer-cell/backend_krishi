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
 * Fetch Call Logs for a Customer/Dealer or Sales Agent
 */
const getCallLogs = async (req, res) => {
  try {
    const { customerPhone, agentId, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const query = {};

    if (customerPhone) {
      const cleanPhone = customerPhone.replace(/\D/g, '').replace(/^91/, '');
      query.customerPhone = { $regex: cleanPhone };
    }

    if (agentId) {
      query.agentId = agentId;
    }

    // Role Security: Sales agents can ONLY see call logs for their assigned leads or calls made by them
    if (req.user.role === 'sales') {
      query.agentId = req.user.id;
    }

    const callLogs = await CallLog.find(query)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CallLog.countDocuments(query);

    res.json({
      success: true,
      data: callLogs,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Handle MyOperator Inbound Call Webhooks
 * Listens to: call.initiated, call.dial_begin, call.answered, call.end, call.summary, disposition
 */
const handleCallWebhook = async (req, res) => {
  try {
    const payload = req.body || {};
    console.log('[MyOperator Call Webhook Event]:', JSON.stringify(payload));

    const event = payload.event || payload.type || req.headers['x-event'] || 'call.summary';
    const callId = payload.call_id || payload.id || payload.uuid || payload.uid;
    const customerPhone = (payload.customer_number || payload.caller_number || payload.phone || '').replace(/\D/g, '').replace(/^91/, '');
    const agentPhone = (payload.agent_number || payload.receiver_number || '').replace(/\D/g, '').replace(/^91/, '');
    const duration = parseInt(payload.duration || payload.call_duration || payload.talk_time || 0);
    const recordingUrl = payload.recording_url || payload.filename || payload.audio_url || null;
    const callSummary = payload.summary || payload.disposition || payload.status || 'Call Ended';

    if (callId || customerPhone) {
      let callLog = await CallLog.findOne({ callId: String(callId) });

      if (!callLog) {
        // Try finding matching sales agent
        let agentId = null;
        if (agentPhone) {
          const agentUser = await User.findOne({ phoneNumber: { $regex: agentPhone } });
          if (agentUser) agentId = agentUser._id;
        }

        callLog = new CallLog({
          callId: String(callId || `CALL_${Date.now()}`),
          type: payload.direction === 'inbound' ? 'inbound' : 'outbound',
          customerPhone: customerPhone || 'Unknown',
          agentPhone,
          agentId,
          status: 'initiated'
        });
      }

      // Update call status & details based on event
      if (event === 'call.answered') {
        callLog.status = 'answered';
      } else if (event === 'call.end' || event === 'call.summary') {
        callLog.status = duration > 0 ? 'answered' : (payload.status === 'busy' ? 'busy' : 'missed');
        callLog.durationSeconds = duration;
        if (recordingUrl) callLog.recordingUrl = recordingUrl;
        callLog.callSummary = callSummary;
      } else if (payload.status) {
        callLog.status = payload.status.toLowerCase();
      }

      callLog.metadata = { ...callLog.metadata, ...payload };
      await callLog.save();

      // Broadcast call update via WebSockets to CRM
      const populatedLog = await CallLog.findById(callLog._id).populate('agentId', 'firstName lastName');
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
    res.status(200).json({ success: false, message: error.message }); // Always 200 to prevent retries
  }
};

module.exports = {
  triggerOutboundCall,
  getCallLogs,
  handleCallWebhook
};
