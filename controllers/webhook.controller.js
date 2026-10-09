const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const myoperatorService = require('../services/myoperator.service');
const wsService = require('../services/websocket.service');
const { normalizeIndianPhone, getPhoneQueryVariants } = require('../utils/phone');

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
                messageId: msg.id,
                timestamp: msg.timestamp
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
    const innerPayload = payload.payload || {};
    const customerData =
      innerPayload.conversation ||
      payload.customer ||
      payload.data?.customer ||
      payload.details?.customer ||
      {};

    const messageData =
      payload.payload ||
      payload.message ||
      payload.data?.message ||
      payload.details?.message ||
      payload.data ||
      payload.details ||
      payload;

    const rawPhone =
      payload.customer_identifier ||
      customerData.customer_contact ||
      customerData.customer_number ||
      payload.sender ||
      payload.from ||
      payload.phone ||
      payload.mobile ||
      payload.customer_number ||
      payload.customer_contact ||
      payload.wa_id ||
      payload.data?.sender ||
      payload.data?.from ||
      payload.data?.phone ||
      payload.data?.mobile ||
      payload.data?.customer_number ||
      payload.data?.customer_contact ||
      payload.details?.sender ||
      payload.details?.from ||
      payload.details?.phone ||
      payload.details?.customer_contact ||
      customerData.phoneNumber ||
      customerData.phone_number ||
      customerData.contact ||
      customerData.phone ||
      customerData.mobile ||
      messageData.phoneNumber ||
      messageData.phone_number ||
      messageData.customer_contact ||
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
        payload.system_identifier ||
        innerPayload.phone_number_id ||
        payload.phone_number_id ||
        payload.phone_id ||
        payload.data?.phone_number_id ||
        payload.details?.phone_number_id;

      const customerName =
        customerData.customer_name ||
        customerData.name ||
        payload.name ||
        payload.sender_name ||
        customerData.customer_name ||
        payload.data?.sender_name ||
        payload.details?.sender_name;

      const rawMyopId =
        innerPayload.id ||
        messageData.id ||
        messageData.message_id ||
        (payload.message_id && payload.message_id !== payload.id && payload.message_id !== payload.event_id ? payload.message_id : undefined) ||
        (payload.id && !payload.id.startsWith('event-') ? payload.id : undefined);

      const rawWabaId =
        innerPayload.metadata?.waba_msg_id ||
        messageData.metadata?.waba_msg_id ||
        messageData.waba_msg_id ||
        payload.waba_msg_id ||
        payload.data?.metadata?.waba_msg_id ||
        payload.data?.waba_msg_id ||
        payload.details?.waba_msg_id;

      const rawMsgId = (rawMyopId && String(rawMyopId).length <= 40 && !String(rawMyopId).startsWith('wamid.'))
        ? String(rawMyopId).trim()
        : (rawWabaId ? String(rawWabaId).trim() : (rawMyopId ? String(rawMyopId).trim() : undefined));

      const rawTs =
        innerPayload.created ||
        innerPayload.timestamp ||
        messageData.timestamp ||
        messageData.created_at ||
        messageData.time ||
        payload.timestamp ||
        payload.created_at ||
        payload.time ||
        payload.data?.timestamp ||
        payload.details?.timestamp;

      await processIncomingMessage({
        phone: rawPhone,
        name: customerName,
        messageObj: messageData,
        phoneNumberId: rawPhoneId,
        receiver: rawReceiver,
        messageId: rawMsgId,
        wabaMessageId: rawWabaId ? String(rawWabaId).trim() : undefined,
        timestamp: rawTs
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
async function processIncomingMessage({ phone, name, messageObj, phoneNumberId, receiver, messageId, wabaMessageId, timestamp }) {
  if (!phone) {
    console.warn('[MyOperator Webhook] Missing phone number in incoming message');
    return;
  }

  console.log(`[MyOperator Webhook] 📩 Inbound Message from ${phone} -> DID: ${receiver || 'N/A'}, PhoneID: ${phoneNumberId || 'N/A'}`);

  const cleanPhone = normalizeIndianPhone(phone);
  const phoneVariants = getPhoneQueryVariants(phone);
  const cleanReceiver = receiver ? normalizeIndianPhone(receiver) : '';

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
      { phoneNumber: { $in: phoneVariants } },
      { phoneNumber: cleanPhone },
      { phoneNumber: phone }
    ]
  }).populate('assignedAgent');

  if (!assignedAgentId && existingUser?.assignedAgent) {
    assignedAgentId = existingUser.assignedAgent._id || existingUser.assignedAgent;
  }

  // 2. Find or Create Contact
  let contact = await Contact.findOne({
    $or: [
      { phone: { $in: phoneVariants } },
      { phone: cleanPhone },
      { phone: phone }
    ]
  });

  const resolvedName =
    name ||
    (existingUser
      ? `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() ||
        existingUser.shopName
      : null);

  if (!contact) {
    if (!assignedAgentId) {
      assignedAgentId = await myoperatorService.assignNextSalesAgent();
    }
    const computedName = resolvedName || `User ${cleanPhone.slice(-4)}`;

    contact = new Contact({
      name: computedName,
      phone: cleanPhone,
      assignedTo: assignedAgentId,
      tags: existingUser ? [existingUser.role === 'dealer' ? 'Dealer' : 'Lead'] : ['myoperator-lead']
    });
    await contact.save();
  } else {
    let contactNeedsSave = false;
    if (contact.phone !== cleanPhone && cleanPhone.length === 10) {
      contact.phone = cleanPhone;
      contactNeedsSave = true;
    }
    // If we have a direct agent line match, ensure contact is assigned to that agent
    if (assignedAgentId && String(contact.assignedTo) !== String(assignedAgentId)) {
      contact.assignedTo = assignedAgentId;
      contactNeedsSave = true;
    }
    // If contact has a placeholder or generic name and we now have a resolved real name, update it!
    if (resolvedName && (!contact.name || contact.name === 'WhatsApp User' || contact.name.startsWith('User ') || /^\d+$/.test(contact.name))) {
      contact.name = resolvedName;
      contactNeedsSave = true;
    }
    if (contactNeedsSave) {
      await contact.save();
    }
  }

  const isDealer = existingUser?.role === 'dealer' || (contact.tags || []).some(t => /dealer|retailer/i.test(t));
  const contactType = isDealer ? 'dealer' : 'lead';

  // 3. Find or Create Conversation
  let conversation = await Conversation.findOne({
    $or: [
      { contactId: contact._id },
      { contactPhone: cleanPhone }
    ]
  });
  if (!conversation) {
    conversation = new Conversation({
      contactId: contact._id,
      assignedTo: contact.assignedTo,
      contactType: contactType,
      contactName: contact.name,
      contactPhone: cleanPhone,
      status: 'open',
      unreadCount: 0
    });
    await conversation.save();
  } else if (String(conversation.contactId) !== String(contact._id)) {
    conversation.contactId = contact._id;
    await conversation.save();
  }

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
  } else if (messageObj.data?.context?.body?.context) {
    content = messageObj.data.context.body.context;
  } else if (messageObj.data?.context?.body) {
    content = typeof messageObj.data.context.body === 'string' ? messageObj.data.context.body : (messageObj.data.context.body.context || '');
  } else if (messageObj.data?.context?.text) {
    content = messageObj.data.context.text;
  } else if (messageObj.data?.body) {
    content = messageObj.data.body;
  } else if (messageObj.data?.text) {
    content = messageObj.data.text;
  } else if (typeof messageObj.body === 'string') {
    content = messageObj.body;
  } else if (messageObj.message?.text?.body) {
    content = messageObj.message.text.body;
  } else if (typeof messageObj.message?.text === 'string') {
    content = messageObj.message.text;
  } else if (typeof messageObj.message === 'string') {
    content = messageObj.message;
  } else if (typeof messageObj.content === 'string') {
    content = messageObj.content;
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

  // Parse exact message creation timestamp
  let parsedTimestamp = new Date();
  const rawTs = timestamp || messageObj.timestamp || messageObj.created_at || messageObj.time || messageObj.message_timestamp;
  if (rawTs) {
    const num = Number(rawTs);
    if (!isNaN(num) && num > 0) {
      parsedTimestamp = new Date(num > 1e11 ? num : num * 1000);
    } else {
      const parsed = new Date(rawTs);
      if (!isNaN(parsed.getTime())) parsedTimestamp = parsed;
    }
  }

  // 4a. Check if message with this exact ID is already recorded to prevent duplicate processing
  let cleanMsgId = undefined;
  if (messageId && typeof messageId === 'string' && messageId.trim() && messageId !== 'undefined' && messageId !== 'null') {
    cleanMsgId = messageId.trim();
  }
  let cleanWabaId = undefined;
  if (wabaMessageId && typeof wabaMessageId === 'string' && wabaMessageId.trim() && wabaMessageId !== 'undefined' && wabaMessageId !== 'null') {
    cleanWabaId = wabaMessageId.trim();
  }

  const orLookup = [];
  if (cleanMsgId) {
    orLookup.push({ myoperatorMessageId: cleanMsgId });
    orLookup.push({ wabaMessageId: cleanMsgId });
  }
  if (cleanWabaId) {
    orLookup.push({ wabaMessageId: cleanWabaId });
    orLookup.push({ myoperatorMessageId: cleanWabaId });
  }

  if (orLookup.length > 0) {
    const existingMsg = await Message.findOne({ $or: orLookup });
    if (existingMsg) {
      console.log(`[MyOperator Webhook] Message ${cleanMsgId || cleanWabaId} already processed, updating IDs if missing.`);
      let needsSave = false;
      if (cleanMsgId && cleanMsgId.length <= 40 && !cleanMsgId.startsWith('wamid.') && existingMsg.myoperatorMessageId !== cleanMsgId) {
        existingMsg.myoperatorMessageId = cleanMsgId;
        needsSave = true;
      }
      if (cleanWabaId && !existingMsg.wabaMessageId) {
        existingMsg.wabaMessageId = cleanWabaId;
        needsSave = true;
      }
      if (needsSave) {
        await existingMsg.save().catch(() => {});
      }
      return;
    }
  }

  const isNewerOrEqual = !conversation.lastMessageAt || parsedTimestamp.getTime() >= new Date(conversation.lastMessageAt).getTime();
  const updateFields = {
    status: 'open',
    contactType: contactType,
    contactName: contact.name,
    contactPhone: cleanPhone,
    ...(contact.assignedTo ? { assignedTo: contact.assignedTo } : {})
  };
  if (isNewerOrEqual) {
    updateFields.lastMessageAt = parsedTimestamp;
    updateFields.lastMessage = {
      type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
      content: content || (mediaUrl ? `[${msgType}]` : ''),
      mediaUrl
    };
  }
  if (!conversation.lastIncomingMessageAt || parsedTimestamp.getTime() >= new Date(conversation.lastIncomingMessageAt).getTime()) {
    updateFields.lastIncomingMessageAt = parsedTimestamp;
  }

  const updatedConversation = await Conversation.findByIdAndUpdate(
    conversation._id,
    {
      $set: updateFields,
      $inc: { unreadCount: 1 }
    },
    { returnDocument: 'after' }
  );
  if (updatedConversation) conversation = updatedConversation;

  // 4b. Extract WhatsApp reply context if customer quoted a message
  let replyToData = undefined;
  const rawContextId =
    messageObj.context?.id ||
    messageObj.context?.message_id ||
    messageObj.context_id ||
    messageObj.data?.context?.id ||
    messageObj.data?.context_message_id;

  if (rawContextId) {
    try {
      const parentMsg = await Message.findOne({
        $or: [
          { myoperatorMessageId: rawContextId.toString().trim() },
          { wabaMessageId: rawContextId.toString().trim() }
        ]
      }).lean();
      if (parentMsg) {
        replyToData = {
          messageId: parentMsg._id.toString(),
          senderName: parentMsg.direction === 'outgoing' ? 'You' : (contact.name || 'Lead'),
          content: parentMsg.content || (parentMsg.mediaUrl ? '[Media]' : ''),
          mediaUrl: parentMsg.mediaUrl
        };
      }
    } catch (_) {}
  }

  let message;
  try {
    message = new Message({
      conversationId: conversation._id,
      contactId: contact._id,
      direction: 'incoming',
      type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
      content: content || (mediaUrl ? `[${msgType}]` : ''),
      mediaUrl,
      myoperatorMessageId: cleanMsgId,
      wabaMessageId: cleanWabaId,
      replyTo: replyToData,
      status: 'delivered',
      createdAt: parsedTimestamp
    });
    await message.save();
  } catch (err) {
    if (err.code === 11000) {
      console.warn(`[MyOperator Webhook] Duplicate key on messageId ${cleanMsgId}, persisting message without collision:`, err.message);
      message = new Message({
        conversationId: conversation._id,
        contactId: contact._id,
        direction: 'incoming',
        type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
        content: content || (mediaUrl ? `[${msgType}]` : ''),
        mediaUrl,
        wabaMessageId: cleanWabaId,
        replyTo: replyToData,
        status: 'delivered',
        createdAt: parsedTimestamp
      });
      await message.save();
    } else {
      throw err;
    }
  }

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

  wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
  console.log(`[MyOperator Webhook] ✅ Broadcasted real-time NEW_MESSAGE for ${cleanPhone} to agent ${contact.assignedTo}`);
}

/**
 * Message Delivery & Status Update Processor
 */
async function processMessageStatusUpdate({ messageId, status }) {
  if (!messageId) return;

  const cleanStatus = (status || '').toString().toLowerCase().trim();
  const cleanId = messageId.toString().trim();

  const updatedMsg = await Message.findOneAndUpdate(
    {
      $or: [
        { myoperatorMessageId: cleanId },
        { wabaMessageId: cleanId }
      ]
    },
    { status: cleanStatus },
    { returnDocument: 'after' }
  );

  if (updatedMsg) {
    const broadcastPayload = {
      type: 'MESSAGE_STATUS_UPDATED',
      data: {
        conversationId: updatedMsg.conversationId,
        messageId: updatedMsg._id,
        status: cleanStatus
      }
    };
    wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
    console.log(`[MyOperator Webhook] ✅ Message ${cleanId} status updated to ${cleanStatus}`);
  }
}

module.exports = { handleWebhook };

