const axios = require('axios');
const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const interaktService = require('../services/interakt.service');
const wsService = require('../services/websocket.service');

const handleWebhook = async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.type) {
      console.warn('[Interakt Webhook] Received invalid payload');
      return res.status(400).json({ success: false });
    }

    const { type, data } = payload;
    console.log(`[Interakt Webhook] Received event: ${type}`);

    // Acknowledge receipt within 3 seconds as required by Interakt
    res.status(200).json({ success: true });

    // Handle Incoming Customer Messages
    const isIncomingMessage = type === 'message_received' ||
      type === 'customer_message_received' ||
      type === 'message_api_received' ||
      type === 'incoming_message' ||
      (type.includes('message') && type.includes('received'));

    if (isIncomingMessage) {
      const customer = data?.customer || data?.data?.customer || {};
      const messageData = data?.message || data?.data?.message || data || {};
      const phone = customer.phoneNumber || customer.phone_number || customer.phone || messageData.phoneNumber || messageData.phone_number || messageData.from;

      if (!phone) {
        console.warn('[Interakt Webhook] Received message_received without phone number', JSON.stringify(payload));
        return;
      }

      console.log(`[Interakt Webhook] Incoming message from: ${phone}`);

      // 1. Create or Find Contact (Robust phone lookup)
      const cleanPhone = phone.replace(/[^\d]/g, '').replace(/^91/, '');
      let contact = await Contact.findOne({
        $or: [
          { phone: phone },
          { phone: cleanPhone },
          { phone: `91${cleanPhone}` },
          { phone: `+91${cleanPhone}` }
        ]
      });

      // Look up if a User exists in the database with this phone number
      const existingUser = await User.findOne({
        $or: [
          { phoneNumber: phone },
          { phoneNumber: cleanPhone },
          { phoneNumber: `91${cleanPhone}` },
          { phoneNumber: `+91${cleanPhone}` }
        ]
      });

      let assignedAgentId = existingUser ? (existingUser.assignedAgent?._id || existingUser.assignedAgent) : null;

      if (!contact) {
        if (!assignedAgentId) {
          assignedAgentId = await interaktService.assignNextSalesAgent();
        }
        contact = new Contact({
          name: customer.name || (existingUser ? `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() || existingUser.shopName : null) || `User ${phone.slice(-4)}`,
          phone: cleanPhone,
          assignedTo: assignedAgentId,
          tags: ['interakt-lead']
        });
        await contact.save();
      } else {
        // Sync: If the Contact exists but its assignment is different from the User's assignment, update it!
        if (existingUser && assignedAgentId && String(contact.assignedTo) !== String(assignedAgentId)) {
          contact.assignedTo = assignedAgentId;
          await contact.save();
        }
      }

      // 2. Create or Find Conversation
      let conversation = await Conversation.findOne({ contactId: contact._id });
      if (!conversation) {
        conversation = new Conversation({
          contactId: contact._id,
          assignedTo: contact.assignedTo,
          status: 'open'
        });
        await conversation.save();
      } else {
        // Auto-reopen conversation on customer message
        conversation.status = 'open';

        // Sync Conversation's assignment to match Contact's assignment
        if (String(conversation.assignedTo) !== String(contact.assignedTo)) {
          conversation.assignedTo = contact.assignedTo;
        }
        await conversation.save();
      }

      // Increment unread status
      conversation.unreadCount += 1;
      
      // Determine message fields
      let msgType = messageData.message_type || messageData.type || messageData.msg_type || 'text';
      let content = '';

      if (typeof messageData.text === 'string') {
        content = messageData.text;
      } else if (messageData.text?.body) {
        content = messageData.text.body;
      } else if (typeof messageData.body === 'string') {
        content = messageData.body;
      } else if (typeof messageData.message === 'string') {
        content = messageData.message;
      } else if (messageData.message?.text?.body) {
        content = messageData.message.text.body;
      } else if (typeof messageData.message?.text === 'string') {
        content = messageData.message.text;
      } else if (messageData.button_reply?.title) {
        content = messageData.button_reply.title;
      } else if (messageData.list_reply?.title) {
        content = messageData.list_reply.title;
      } else if (messageData.interactive?.button_reply?.title) {
        content = messageData.interactive.button_reply.title;
      } else if (messageData.interactive?.list_reply?.title) {
        content = messageData.interactive.list_reply.title;
      } else if (messageData.caption) {
        content = messageData.caption;
      }

      let mediaUrl = null;

      if (messageData.image) {
        msgType = 'image';
        mediaUrl = typeof messageData.image === 'string' ? messageData.image : (messageData.image.url || messageData.image.link);
        content = messageData.image.caption || content || '';
      } else if (messageData.document) {
        msgType = 'document';
        mediaUrl = typeof messageData.document === 'string' ? messageData.document : (messageData.document.url || messageData.document.link);
        content = messageData.document.caption || messageData.document.filename || content || '';
      } else if (messageData.video) {
        msgType = 'video';
        mediaUrl = typeof messageData.video === 'string' ? messageData.video : (messageData.video.url || messageData.video.link);
        content = messageData.video.caption || content || '';
      } else if (messageData.audio || messageData.voice) {
        msgType = 'audio';
        const audioObj = messageData.audio || messageData.voice;
        mediaUrl = typeof audioObj === 'string' ? audioObj : (audioObj.url || audioObj.link);
      } else if (messageData.media_url || messageData.mediaUrl) {
        mediaUrl = messageData.media_url || messageData.mediaUrl;
      }

      if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
        mediaUrl = null;
      }

      conversation.lastMessage = { type: msgType, content: content || (mediaUrl ? `[${msgType}]` : ''), mediaUrl };
      conversation.lastMessageAt = new Date();
      await conversation.save();

      // 3. Save Message record
      const message = new Message({
        conversationId: conversation._id,
        contactId: contact._id,
        direction: 'incoming',
        type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
        content,
        mediaUrl,
        interaktMessageId: messageData.id || messageData.message_id || messageData._id,
        status: 'delivered'
      });
      await message.save();

      // 4. Broadcast via Native WebSocket Service
      const populatedMessage = await Message.findById(message._id).populate('sentBy', 'firstName lastName');
      const broadcastPayload = {
        type: 'NEW_MESSAGE',
        data: {
          conversation: await conversation.populate(['contactId', 'assignedTo']),
          message: populatedMessage
        }
      };

      // Notify assigned sales agent if assigned
      if (contact.assignedTo) {
        wsService.sendToUser(contact.assignedTo.toString(), broadcastPayload);
      }
      // Broadcast to admins (admins see all conversations)
      wsService.broadcastToRoles(['admin'], broadcastPayload);
      console.log(`[Interakt Webhook] Success: Broadcasted NEW_MESSAGE for ${phone}`);
    }

    // Handle Message Status updates
    else if (type.startsWith('message_api_')) {
      const messageData = data.message;
      const interaktMessageId = messageData.id;
      
      let status = 'sent';
      if (type === 'message_api_delivered') status = 'delivered';
      if (type === 'message_api_read') status = 'read';
      if (type === 'message_api_failed') status = 'failed';

      const updatedMsg = await Message.findOneAndUpdate(
        { interaktMessageId },
        { status },
        { new: true }
      );

      if (updatedMsg) {
        const broadcastPayload = {
          type: 'MESSAGE_STATUS_UPDATED',
          data: {
            conversationId: updatedMsg.conversationId,
            messageId: updatedMsg._id,
            status
          }
        };

        // Notify assigned rep
        const conversation = await Conversation.findById(updatedMsg.conversationId);
        if (conversation && conversation.assignedTo) {
          wsService.sendToUser(conversation.assignedTo.toString(), broadcastPayload);
        }
        // Notify admins
        wsService.broadcastToRoles(['admin'], broadcastPayload);
      }
    }
  } catch (error) {
    console.error('[Webhook Processing Error]:', error);
  }
};

module.exports = { handleWebhook };
