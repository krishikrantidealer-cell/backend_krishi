const CallLog = require('../models/CallLog');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const User = require('../models/User');
const Order = require('../models/Order');
const Event = require('../models/Event');

/**
 * Customer 360° Unified Timeline Aggregator (Feature #2)
 * Aggregates Calls, WhatsApp Messages, Notes, Orders, and Telemetry Events chronologically.
 */
const getCustomerTimeline = async (req, res) => {
  try {
    const { phone, userId } = req.query;

    if (!phone && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Either customer phone or userId is required'
      });
    }

    const cleanPhone = phone ? phone.replace(/\D/g, '').replace(/^91/, '') : '';

    const phoneVariants = cleanPhone ? [
      cleanPhone,
      `91${cleanPhone}`,
      `+91${cleanPhone}`
    ] : [];

    // 1. Fetch User Profile
    let user = null;
    if (userId) {
      user = await User.findById(userId).populate('assignedAgent', 'firstName lastName email phoneNumber');
    } else if (cleanPhone) {
      user = await User.findOne({
        $or: [
          { phoneNumber: { $in: phoneVariants } },
          { phone: { $in: phoneVariants } }
        ]
      }).populate('assignedAgent', 'firstName lastName email phoneNumber');
    }

    // Role Security: If sales rep, ensure they have access if assigned
    if (req.user.role === 'sales' && user && user.assignedAgent) {
      const assignedId = user.assignedAgent._id?.toString() || user.assignedAgent.toString();
      if (assignedId !== req.user.id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: Customer is assigned to another sales representative.'
        });
      }
    }

    const timelineItems = [];

    // 2. Fetch Call Logs
    const callQuery = {};
    if (cleanPhone) {
      callQuery.customerPhone = { $regex: cleanPhone };
    }
    const callLogs = await CallLog.find(callQuery)
      .populate('agentId', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(30);

    for (const call of callLogs) {
      timelineItems.push({
        id: `call_${call._id}`,
        type: 'call',
        title: `${call.direction === 'inbound' ? '📥 Inbound Call' : '📤 Outbound Call'} (${call.status.toUpperCase()})`,
        subtitle: `Duration: ${call.durationSeconds || 0}s ${call.userDisposition ? `• Disposition: ${call.userDisposition}` : ''}`,
        timestamp: call.createdAt,
        agentName: call.agentId ? `${call.agentId.firstName || ''} ${call.agentId.lastName || ''}`.trim() : 'System',
        recordingUrl: call.recordingUrl || null,
        status: call.status,
        details: {
          direction: call.direction,
          duration: call.durationSeconds,
          disposition: call.userDisposition,
          followUpDate: call.followUpDate,
          notes: call.notes || call.callSummary,
          raw: call
        }
      });
    }

    // 3. Fetch WhatsApp Messages
    const contactQuery = cleanPhone ? { phone: { $in: phoneVariants } } : null;
    if (contactQuery) {
      const contact = await Contact.findOne(contactQuery);
      if (contact) {
        const conversation = await Conversation.findOne({ contactId: contact._id });
        if (conversation) {
          const messages = await Message.find({ conversationId: conversation._id })
            .populate('sentBy', 'firstName lastName')
            .sort({ createdAt: -1 })
            .limit(30);

          for (const msg of messages) {
            timelineItems.push({
              id: `msg_${msg._id}`,
              type: 'whatsapp',
              title: `${msg.direction === 'incoming' ? '💬 Incoming WhatsApp' : '✉️ Outgoing WhatsApp'} (${msg.status})`,
              subtitle: msg.content || (msg.mediaUrl ? `[Attachment: ${msg.type}]` : ''),
              timestamp: msg.createdAt,
              agentName: msg.sentBy ? `${msg.sentBy.firstName || ''} ${msg.sentBy.lastName || ''}`.trim() : (msg.direction === 'incoming' ? 'Customer' : 'Bot / WABA'),
              mediaUrl: msg.mediaUrl || null,
              status: msg.status,
              details: {
                direction: msg.direction,
                messageType: msg.type,
                raw: msg
              }
            });
          }
        }
      }
    }

    // 4. Fetch Notes History
    if (user && Array.isArray(user.notesHistory)) {
      for (const [idx, note] of user.notesHistory.entries()) {
        timelineItems.push({
          id: `note_${user._id}_${idx}`,
          type: 'note',
          title: `📝 ${note.title || 'Internal Note'}`,
          subtitle: note.note || '',
          timestamp: note.createdAt || user.updatedAt,
          agentName: note.author || note.adminName || 'Agent',
          details: {
            noteType: note.type || 'general',
            raw: note
          }
        });
      }
    }

    // 5. Fetch Orders
    const orderQuery = {};
    if (user?._id) {
      orderQuery.user = user._id;
    } else if (cleanPhone) {
      orderQuery['customer.phone'] = { $in: phoneVariants };
    }

    const orders = await Order.find(orderQuery)
      .sort({ createdAt: -1 })
      .limit(15);

    for (const order of orders) {
      timelineItems.push({
        id: `order_${order._id}`,
        type: 'order',
        title: `📦 Order #${order.orderId || order._id.toString().slice(-6)} (₹${order.totalAmount || 0})`,
        subtitle: `Status: ${order.orderStatus || 'Pending'} • Payment: ${order.paymentMethod || 'COD'}`,
        timestamp: order.createdAt,
        status: order.orderStatus,
        details: {
          orderId: order.orderId,
          total: order.totalAmount,
          itemCount: order.items?.length || 0,
          raw: order
        }
      });
    }

    // 6. Fetch Telemetry Events (App Activity)
    if (cleanPhone || user?._id) {
      const eventQuery = {
        $or: [
          ...(cleanPhone ? [{ 'metadata.phone': { $regex: cleanPhone } }, { userPhone: { $regex: cleanPhone } }] : []),
          ...(user?._id ? [{ user: user._id }] : [])
        ]
      };
      const events = await Event.find(eventQuery)
        .sort({ createdAt: -1 })
        .limit(15);

      for (const ev of events) {
        timelineItems.push({
          id: `event_${ev._id}`,
          type: 'telemetry',
          title: `⚡ App Event: ${ev.type || 'User Activity'}`,
          subtitle: ev.details || ev.description || '',
          timestamp: ev.createdAt,
          details: {
            eventType: ev.type,
            raw: ev
          }
        });
      }
    }

    // Sort all aggregated items strictly chronologically (newest first)
    timelineItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      data: {
        user: user ? {
          id: user._id,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.shopName || 'Customer',
          shopName: user.shopName,
          phone: user.phoneNumber || user.phone,
          preferredLanguage: user.preferredLanguage || 'en',
          kycStatus: user.kycStatus,
          assignedAgent: user.assignedAgent
        } : null,
        timeline: timelineItems
      }
    });
  } catch (error) {
    console.error('[Customer 360 Timeline Error]:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCustomerTimeline
};
