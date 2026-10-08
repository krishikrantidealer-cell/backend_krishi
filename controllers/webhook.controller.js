const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const myoperatorService = require('../services/myoperator.service');
const wsService = require('../services/websocket.service');

const handleWebhook = async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || (typeof payload !== 'object' && !Array.isArray(payload))) {
      console.warn('[MyOperator Webhook] Received invalid or empty payload');
      return res.status(400).json({ success: false, message: 'Invalid payload' });
    }

    // Acknowledge receipt immediately (required by MyOperator & Meta within 3 seconds)
    res.status(200).json({ success: true, message: 'Webhook received' });

    console.log('[MyOperator Webhook Payload]:', JSON.stringify(payload));

    // Determine event type from all possible top-level and nested fields
    const eventType = String(
      payload.event ||
      payload.event_type ||
      payload.type ||
      payload.action ||
      payload.data?.event ||
      payload.data?.event_type ||
      payload.data?.type ||
      payload.details?.event ||
      payload.details?.event_type ||
      (payload.entry ? 'meta_entry' : '') ||
      ''
    ).toLowerCase();

    console.log(`[MyOperator Webhook] Processing event: "${eventType}" | Keys: ${Object.keys(payload).join(', ')}`);

    // ─── Case 1: Meta Cloud API format (entry[0].changes[0].value) ─────────────
    if (payload.entry && Array.isArray(payload.entry)) {
      for (const entryItem of payload.entry) {
        const changes = entryItem.changes || [];
        for (const change of changes) {
          const value = change.value || {};
          
          // Inbound messages
          if (value.messages && Array.isArray(value.messages)) {
            for (const msg of value.messages) {
              await processIncomingMessage({
                phone: msg.from,
                name: value.contacts?.[0]?.profile?.name,
                messageObj: msg,
                phoneNumberId: value.metadata?.phone_number_id,
                receiver: value.metadata?.display_phone_number,
                messageId: msg.id
              });
            }
          }

          // Message statuses
          if (value.statuses && Array.isArray(value.statuses)) {
            for (const statusObj of value.statuses) {
              await processMessageStatusUpdate({
                messageId: statusObj.id,
                status: statusObj.status
              });
            }
          }
        }
      }
      return;
    }

    // ─── Case 2: MyOperator WhatsApp Webhook Inbound Message ──────────────────
    const customerData = payload.customer || payload.data?.customer || payload.details?.customer || {};
    const messageData = payload.message || payload.data?.message || payload.details?.message || payload.data || payload.details || payload;

    const rawPhone =
      payload.sender ||
      payload.from ||
      payload.phone ||
      payload.mobile ||
      payload.customer_number ||
      payload.wa_id ||
      payload.data?.sender ||
      payload.data?.from ||
      payload.data?.phone ||
      payload.data?.mobile ||
      payload.data?.customer_number ||
      payload.details?.sender ||
      payload.details?.from ||
      payload.details?.phone ||
      customerData.phoneNumber ||
      customerData.phone_number ||
      customerData.phone ||
      customerData.mobile ||
      messageData.phoneNumber ||
      messageData.phone_number ||
      messageData.from ||
      messageData.sender ||
      messageData.phone;

    const isStatusUpdate =
      eventType.includes('sent') ||
      eventType.includes('delivered') ||
      eventType.includes('read') ||
      eventType.includes('failed') ||
      eventType.startsWith('message_api_') ||
      (payload.status && !rawPhone);

    const isIncomingMessage = !isStatusUpdate && (
      eventType === 'message.received' ||
      eventType === 'message_received' ||
      eventType === 'customer_message_received' ||
      eventType === 'message_api_received' ||
      eventType === 'incoming_message' ||
      (eventType.includes('message') && (eventType.includes('receive') || eventType.includes('inbound'))) ||
      Boolean(rawPhone)
    );

    if (isIncomingMessage && rawPhone) {
      const rawReceiver =
        payload.receiver ||
        payload.to ||
        payload.did ||
        payload.virtual_number ||
        payload.data?.receiver ||
        payload.data?.to ||
        payload.details?.receiver ||
        customerData.receiver;

      const rawPhoneId =
        payload.phone_number_id ||
        payload.phone_id ||
        payload.data?.phone_number_id ||
        payload.details?.phone_number_id;

      const customerName =
        customerData.name ||
        payload.name ||
        payload.sender_name ||
        customerData.customer_name ||
        payload.data?.sender_name ||
        payload.details?.sender_name;

      await processIncomingMessage({
        phone: rawPhone,
        name: customerName,
        messageObj: messageData,
        phoneNumberId: rawPhoneId,
        receiver: rawReceiver,
        messageId: messageData.id || messageData.message_id || payload.message_id || payload.id
      });
      return;
    }

    // ─── Case 3: Outgoing Message Status Updates ──────────────────────────────
    if (isStatusUpdate) {
      const myopMsgId =
        messageData.id ||
        messageData.message_id ||
        payload.message_id ||
        payload.id;

      let status = 'sent';
      if (eventType.includes('delivered') || payload.status === 'delivered') status = 'delivered';
      if (eventType.includes('read') || payload.status === 'read') status = 'read';
      if (eventType.includes('failed') || payload.status === 'failed') status = 'failed';

      await processMessageStatusUpdate({
        messageId: myopMsgId,
        status
      });
    }
  } catch (error) {
    console.error('[MyOperator Webhook Processing Error]:', error);
  }
};

/**
 * Robust Inbound Message Processor with Direct Agent Line Mapping
 */
async function processIncomingMessage({ phone, name, messageObj, phoneNumberId, receiver, messageId }) {
  if (!phone) {
    console.warn('[MyOperator Webhook] Missing phone number in incoming message');
    return;
  }

  console.log(`[MyOperator Webhook] 📩 Inbound Message from ${phone} -> DID: ${receiver || 'N/A'}, PhoneID: ${phoneNumberId || 'N/A'}`);

  const cleanPhone = phone.toString().replace(/[^\d]/g, '').replace(/^91/, '');
  const cleanReceiver = receiver ? receiver.toString().replace(/[^\d]/g, '').replace(/^91/, '') : '';

  // 1. Resolve Assigned Sales Agent
  let assignedAgentId = null;

  // A. Try resolving agent by WABA Phone Number ID or Virtual DID Line
  if (phoneNumberId || cleanReceiver) {
    const lineAgent = await User.findOne({
      $or: [
        ...(phoneNumberId ? [{ 'myoperatorConfig.wabaPhoneNumberId': phoneNumberId.toString() }] : []),
        ...(cleanReceiver ? [
          { 'myoperatorConfig.virtualNumber': cleanReceiver },
          { 'myoperatorConfig.virtualNumber': `91${cleanReceiver}` },
          { 'myoperatorConfig.virtualNumber': `+91${cleanReceiver}` }
        ] : [])
      ]
    });
    if (lineAgent) {
      assignedAgentId = lineAgent._id;
      console.log(`[MyOperator Webhook] 🎯 Routed to dedicated agent line: ${lineAgent.firstName} ${lineAgent.lastName} (${lineAgent.email})`);
    }
  }

  // B. Check existing User (Lead/Dealer profile)
  const existingUser = await User.findOne({
    $or: [
      { phoneNumber: cleanPhone },
      { phoneNumber: `91${cleanPhone}` },
      { phoneNumber: `+91${cleanPhone}` },
      { phoneNumber: phone }
    ]
  }).populate('assignedAgent');

  if (!assignedAgentId && existingUser?.assignedAgent) {
    assignedAgentId = existingUser.assignedAgent._id || existingUser.assignedAgent;
  }

  // 2. Find or Create Contact
  let contact = await Contact.findOne({
    $or: [
      { phone: cleanPhone },
      { phone: `91${cleanPhone}` },
      { phone: `+91${cleanPhone}` },
      { phone: phone }
    ]
  });

  if (!contact) {
    if (!assignedAgentId) {
      assignedAgentId = await myoperatorService.assignNextSalesAgent();
    }
    const computedName =
      name ||
      (existingUser
        ? `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() ||
          existingUser.shopName
        : null) ||
      `User ${cleanPhone.slice(-4)}`;

    contact = new Contact({
      name: computedName,
      phone: cleanPhone,
      assignedTo: assignedAgentId,
      tags: ['myoperator-lead']
    });
    await contact.save();
  } else {
    // If we have a direct agent line match, ensure contact is assigned to that agent
    if (assignedAgentId && String(contact.assignedTo) !== String(assignedAgentId)) {
      contact.assignedTo = assignedAgentId;
      await contact.save();
    }
    if (name && (contact.name.startsWith('User ') || contact.name === 'WhatsApp User')) {
      contact.name = name;
      await contact.save();
    }
  }

  // 3. Find or Create Conversation
  let conversation = await Conversation.findOne({ contactId: contact._id });
  if (!conversation) {
    conversation = new Conversation({
      contactId: contact._id,
      assignedTo: contact.assignedTo,
      status: 'open'
    });
  } else {
    conversation.status = 'open';
    if (String(conversation.assignedTo) !== String(contact.assignedTo)) {
      conversation.assignedTo = contact.assignedTo;
    }
  }

  conversation.unreadCount = (conversation.unreadCount || 0) + 1;

  // 4. Extract Message Type, Content & Media
  let msgType = messageObj.message_type || messageObj.type || messageObj.msg_type || 'text';
  let content = '';

  if (messageObj.button_reply?.title) {
    content = messageObj.button_reply.title;
  } else if (messageObj.list_reply?.title) {
    content = messageObj.list_reply.title;
  } else if (messageObj.interactive?.button_reply?.title) {
    content = messageObj.interactive.button_reply.title;
  } else if (messageObj.interactive?.list_reply?.title) {
    content = messageObj.interactive.list_reply.title;
  } else if (messageObj.text?.body) {
    content = messageObj.text.body;
  } else if (typeof messageObj.text === 'string') {
    content = messageObj.text;
  } else if (typeof messageObj.body === 'string') {
    content = messageObj.body;
  } else if (messageObj.message?.text?.body) {
    content = messageObj.message.text.body;
  } else if (typeof messageObj.message?.text === 'string') {
    content = messageObj.message.text;
  } else if (typeof messageObj.message === 'string') {
    content = messageObj.message;
  } else if (messageObj.caption) {
    content = messageObj.caption;
  }

  // Parse JSON-stringified interactive messages if any
  if (typeof content === 'string' && content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.button_reply?.title) content = parsed.button_reply.title;
      else if (parsed.list_reply?.title) content = parsed.list_reply.title;
      else if (parsed.interactive?.button_reply?.title) content = parsed.interactive.button_reply.title;
      else if (parsed.interactive?.list_reply?.title) content = parsed.interactive.list_reply.title;
      else if (parsed.title) content = parsed.title;
    } catch (_) {}
  }

  let mediaUrl = null;
  if (messageObj.image) {
    msgType = 'image';
    mediaUrl = typeof messageObj.image === 'string' ? messageObj.image : (messageObj.image.url || messageObj.image.link);
    content = messageObj.image.caption || content || '';
  } else if (messageObj.document) {
    msgType = 'document';
    mediaUrl = typeof messageObj.document === 'string' ? messageObj.document : (messageObj.document.url || messageObj.document.link);
    content = messageObj.document.caption || messageObj.document.filename || content || '';
  } else if (messageObj.video) {
    msgType = 'video';
    mediaUrl = typeof messageObj.video === 'string' ? messageObj.video : (messageObj.video.url || messageObj.video.link);
    content = messageObj.video.caption || content || '';
  } else if (messageObj.audio || messageObj.voice) {
    msgType = 'audio';
    const audioObj = messageObj.audio || messageObj.voice;
    mediaUrl = typeof audioObj === 'string' ? audioObj : (audioObj.url || audioObj.link);
  } else if (messageObj.media_url || messageObj.mediaUrl) {
    mediaUrl = messageObj.media_url || messageObj.mediaUrl;
  }

  if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) {
    mediaUrl = null;
  }

  conversation.lastMessage = {
    type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
    content: content || (mediaUrl ? `[${msgType}]` : ''),
    mediaUrl
  };
  conversation.lastMessageAt = new Date();
  await conversation.save();

  // 5. Save Message Record
  const message = new Message({
    conversationId: conversation._id,
    contactId: contact._id,
    direction: 'incoming',
    type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
    content: content || (mediaUrl ? `[${msgType}]` : ''),
    mediaUrl,
    myoperatorMessageId: messageId ? messageId.toString() : undefined,
    status: 'delivered'
  });
  await message.save();

  // 6. Broadcast Real-Time Update via WebSockets
  const populatedMessage = await Message.findById(message._id).populate('sentBy', 'firstName lastName');
  const populatedConversation = await Conversation.findById(conversation._id).populate(['contactId', 'assignedTo']);

  const broadcastPayload = {
    type: 'NEW_MESSAGE',
    data: {
      conversation: populatedConversation,
      message: populatedMessage
    }
  };

  if (contact.assignedTo) {
    wsService.sendToUser(contact.assignedTo.toString(), broadcastPayload);
  }
  wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
  console.log(`[MyOperator Webhook] ✅ Broadcasted real-time NEW_MESSAGE for ${cleanPhone} to agent ${contact.assignedTo}`);
}

/**
 * Message Delivery & Status Update Processor
 */
async function processMessageStatusUpdate({ messageId, status }) {
  if (!messageId) return;

  const updatedMsg = await Message.findOneAndUpdate(
    {
      $or: [
        { myoperatorMessageId: messageId.toString() },
        { interaktMessageId: messageId.toString() }
      ]
    },
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
    const conversation = await Conversation.findById(updatedMsg.conversationId);
    if (conversation?.assignedTo) {
      wsService.sendToUser(conversation.assignedTo.toString(), broadcastPayload);
    }
    wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
    console.log(`[MyOperator Webhook] ✅ Message ${messageId} status updated to ${status}`);
  }
}

module.exports = { handleWebhook };

