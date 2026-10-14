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
                timestamp: msg.timestamp,
                rawPayload: payload
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

    const isCallEvent =
      eventType.includes('call') ||
      eventType.includes('ring') ||
      eventType.includes('dial') ||
      eventType.includes('answer') ||
      eventType.includes('hang') ||
      eventType.includes('bridge') ||
      eventType.includes('ivr') ||
      String(payload.channel || '').toLowerCase() === 'call' ||
      Boolean(payload.legs || payload.call_id || payload.recording_url || payload.recording_filename || payload.cli);

    if (isCallEvent) {
      console.log(`[MyOperator Webhook] Diverting call event "${eventType}" away from WhatsApp CRM to callController`);
      const callController = require('./call.controller');
      return callController.handleCallWebhook(req, res);
    }

    const isStatusUpdate =
      eventType.includes('sent') ||
      eventType.includes('delivered') ||
      eventType.includes('read') ||
      eventType.includes('failed') ||
      eventType.startsWith('message_api_') ||
      (payload.status && !rawPhone);

    const isIncomingMessage = !isStatusUpdate && !isCallEvent && (
      eventType === 'message.received' ||
      eventType === 'message_received' ||
      eventType === 'customer_message_received' ||
      eventType === 'message_api_received' ||
      eventType === 'incoming_message' ||
      (eventType.includes('message') && (eventType.includes('receive') || eventType.includes('inbound'))) ||
      String(payload.channel || '').toLowerCase() === 'whatsapp' ||
      (Boolean(rawPhone) && (messageData.data != null || messageData.text != null || messageData.body != null || messageData.message != null || messageData.image != null || messageData.document != null || messageData.media_url != null))
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
        timestamp: rawTs,
        companyId: payload.company_id || innerPayload?.company_id,
        rawPayload: payload
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

      const rawWabaId =
        innerPayload.metadata?.waba_msg_id ||
        messageData.metadata?.waba_msg_id ||
        messageData.waba_msg_id ||
        payload.waba_msg_id ||
        payload.data?.metadata?.waba_msg_id ||
        payload.data?.waba_msg_id ||
        payload.details?.waba_msg_id;

      const errorReason =
        messageData.metadata?.errors?.[0]?.title ||
        messageData.metadata?.errors?.[0]?.message ||
        messageData.metadata?.error ||
        payload.error ||
        payload.details?.error ||
        null;

      let status = 'sent';
      if (eventType.includes('delivered') || payload.status === 'delivered') status = 'delivered';
      if (eventType.includes('read') || payload.status === 'read') status = 'read';
      if (eventType.includes('failed') || payload.status === 'failed') status = 'failed';

      await processMessageStatusUpdate({
        messageId: myopMsgId,
        status,
        wabaMessageId: rawWabaId,
        errorReason
      });
    }
  } catch (error) {
    console.error('[MyOperator Webhook Processing Error]:', error);
  }
};

/**
 * Robust Inbound Message Processor with Direct Agent Line Mapping
 */
async function processIncomingMessage({ phone, name, messageObj, phoneNumberId, receiver, messageId, wabaMessageId, timestamp, rawPayload, companyId }) {
  if (!phone) {
    console.warn('[MyOperator Webhook] Missing phone number in incoming message');
    return;
  }

  console.log(`[MyOperator Webhook] 📩 Inbound Message from ${phone} -> DID: ${receiver || 'N/A'}, PhoneID: ${phoneNumberId || 'N/A'}, CompanyID: ${companyId || 'N/A'}`);

  const cleanPhone = normalizeIndianPhone(phone);
  const phoneVariants = getPhoneQueryVariants(phone);
  const cleanReceiver = receiver ? normalizeIndianPhone(receiver) : '';

  // 1. Resolve Assigned Sales Agent (CRITICAL: Only assign valid sales agents or admins, NEVER random customer users!)
  let assignedAgentId = null;

  // A. Priority 1: Check existing Lead/Dealer profile in User collection
  const existingUser = await User.findOne({
    $or: [
      { phoneNumber: { $in: phoneVariants } },
      { phoneNumber: cleanPhone },
      { phoneNumber: phone }
    ]
  }).populate('assignedAgent');

  if (existingUser?.assignedAgent && (existingUser.assignedAgent.role === 'sales' || existingUser.assignedAgent.role === 'admin')) {
    assignedAgentId = existingUser.assignedAgent._id;
  }

  // B. Priority 2: Check existing Contact
  if (!assignedAgentId) {
    const existingContact = await Contact.findOne({
      $or: [
        { phone: { $in: phoneVariants } },
        { phone: cleanPhone },
        { phone: phone }
      ]
    });
    if (existingContact?.assignedTo) {
      const validAgent = await User.findOne({ _id: existingContact.assignedTo, role: { $in: ['sales', 'admin'] }, isDeleted: false });
      if (validAgent) {
        assignedAgentId = validAgent._id;
      }
    }
  }

  // C. Priority 3: Try resolving dedicated agent by dedicated agent line (excluding main company account)
  const mainCompanyId = '6ab0de5d51766538';
  const mainPhoneId = '1307352865799863';
  const isMainLine = (phoneNumberId && phoneNumberId.toString() === mainPhoneId) ||
                     (companyId && companyId.toString() === mainCompanyId);

  if (!assignedAgentId && (phoneNumberId || cleanReceiver || (companyId && companyId !== mainCompanyId)) && !isMainLine) {
    const lineAgent = await User.findOne({
      role: 'sales',
      myoperator: true,
      $or: [
        ...(phoneNumberId ? [{ 'myoperatorConfig.wabaPhoneNumberId': phoneNumberId.toString() }] : []),
        ...(cleanReceiver ? [
          { 'myoperatorConfig.virtualNumber': cleanReceiver },
          { 'myoperatorConfig.virtualNumber': `91${cleanReceiver}` },
          { 'myoperatorConfig.virtualNumber': `+91${cleanReceiver}` }
        ] : []),
        ...(companyId && companyId !== mainCompanyId ? [{ 'myoperatorConfig.companyId': companyId.toString() }] : [])
      ]
    });
    if (lineAgent) {
      assignedAgentId = lineAgent._id;
      console.log(`[MyOperator Webhook] 🎯 Routed to dedicated agent line: ${lineAgent.firstName} ${lineAgent.lastName} (${lineAgent.email})`);
    }
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
    const computedName = resolvedName || `User ${cleanPhone.slice(-4)}`;

    contact = new Contact({
      name: computedName,
      phone: cleanPhone,
      assignedTo: assignedAgentId || null,
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
      unreadCount: 0,
      activeWabaPhoneNumberId: phoneNumberId ? String(phoneNumberId).trim() : undefined,
      activeCompanyId: companyId ? String(companyId).trim() : undefined
    });
    await conversation.save();
  } else {
    let convNeedsSave = false;
    if (String(conversation.contactId) !== String(contact._id)) {
      conversation.contactId = contact._id;
      convNeedsSave = true;
    }
    if (phoneNumberId && conversation.activeWabaPhoneNumberId !== String(phoneNumberId).trim()) {
      conversation.activeWabaPhoneNumberId = String(phoneNumberId).trim();
      convNeedsSave = true;
    }
    if (companyId && conversation.activeCompanyId !== String(companyId).trim()) {
      conversation.activeCompanyId = String(companyId).trim();
      convNeedsSave = true;
    }
    if (convNeedsSave) await conversation.save();
  }

  // 4. Extract Message Type, Content & Media
  const mediaContext = messageObj.data?.context || messageObj.context || messageObj.data || {};
  let rawType = String(messageObj.data?.type || messageObj.message_type || messageObj.type || messageObj.msg_type || 'text').toLowerCase();
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

  let msgType = rawType;
  let mediaUrl = null;
  const mediaLink =
    mediaContext.link ||
    mediaContext.url ||
    mediaContext.media_url ||
    messageObj.media_url ||
    messageObj.mediaUrl ||
    null;

  const rawMime = String(mediaContext.mime_type || '').toLowerCase();

  if (rawType === 'image' || messageObj.image || rawMime.startsWith('image/')) {
    msgType = 'image';
    mediaUrl = typeof messageObj.image === 'string'
      ? messageObj.image
      : (messageObj.image?.url || messageObj.image?.link || mediaLink);
    content = messageObj.image?.caption || mediaContext.caption || content || '';
  } else if (rawType === 'document' || messageObj.document || rawMime.includes('pdf') || mediaContext.filename) {
    msgType = 'document';
    mediaUrl = typeof messageObj.document === 'string'
      ? messageObj.document
      : (messageObj.document?.url || messageObj.document?.link || mediaLink);
    content = messageObj.document?.caption || messageObj.document?.filename || mediaContext.caption || mediaContext.filename || content || '';
  } else if (rawType === 'video' || messageObj.video || rawMime.startsWith('video/')) {
    msgType = 'video';
    mediaUrl = typeof messageObj.video === 'string'
      ? messageObj.video
      : (messageObj.video?.url || messageObj.video?.link || mediaLink);
    content = messageObj.video?.caption || mediaContext.caption || content || '';
  } else if (rawType === 'audio' || messageObj.audio || messageObj.voice || rawMime.startsWith('audio/')) {
    msgType = 'audio';
    const audioObj = messageObj.audio || messageObj.voice;
    mediaUrl = typeof audioObj === 'string'
      ? audioObj
      : (audioObj?.url || audioObj?.link || mediaLink);
  } else if (mediaLink) {
    mediaUrl = mediaLink;
  }

  if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim() || mediaUrl === 'null' || mediaUrl === 'undefined') {
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
      console.log(`[MyOperator Webhook] Message ${cleanMsgId || cleanWabaId} already found, checking for updates.`);
      let needsSave = false;
      if (cleanMsgId && cleanMsgId.length <= 40 && !cleanMsgId.startsWith('wamid.') && existingMsg.myoperatorMessageId !== cleanMsgId) {
        existingMsg.myoperatorMessageId = cleanMsgId;
        needsSave = true;
      }
      if (cleanWabaId && !existingMsg.wabaMessageId) {
        existingMsg.wabaMessageId = cleanWabaId;
        needsSave = true;
      }
      // If the incoming webhook brings a media URL and the existing message lacked it (two-phase MyOperator webhook)
      if (mediaUrl && (!existingMsg.mediaUrl || existingMsg.mediaUrl !== mediaUrl)) {
        existingMsg.mediaUrl = mediaUrl;
        if (msgType && msgType !== 'text') existingMsg.type = msgType;
        if (content && !existingMsg.content) existingMsg.content = content;
        needsSave = true;
      }
      if (needsSave) {
        await existingMsg.save().catch(() => {});
        conversation.lastMessage = {
          type: existingMsg.type,
          content: existingMsg.content || (existingMsg.mediaUrl ? `[${existingMsg.type}]` : ''),
          mediaUrl: existingMsg.mediaUrl
        };
        await conversation.save().catch(() => {});

        const populatedMessage = await Message.findById(existingMsg._id).populate('sentBy', 'firstName lastName');
        const populatedConversation = await Conversation.findById(conversation._id).populate(['contactId', 'assignedTo']);
        const broadcastPayload = {
          type: 'NEW_MESSAGE',
          data: {
            conversation: populatedConversation,
            message: populatedMessage
          }
        };
        const targetAgentId = contact?.assignedTo || conversation?.assignedTo;
        if (targetAgentId) {
          const agentIdStr = targetAgentId._id ? targetAgentId._id.toString() : targetAgentId.toString();
          wsService.sendToUser(agentIdStr, broadcastPayload);
        }
        wsService.broadcastToRoles(['admin'], broadcastPayload);
      }
      return;
    }
  }

  // Drop phantom blank messages with no content and no media
  if (!content?.trim() && !mediaUrl && !['image', 'document', 'audio', 'video'].includes(msgType)) {
    console.warn(`[MyOperator Webhook] Dropping blank message from ${phone} (no content, no media)`);
    return;
  }

  const isNewerOrEqual = !conversation.lastMessageAt || parsedTimestamp.getTime() >= new Date(conversation.lastMessageAt).getTime();
  const updateFields = {
    status: 'open',
    contactType: contactType,
    contactName: contact.name,
    contactPhone: cleanPhone,
    ...(contact.assignedTo ? { assignedTo: contact.assignedTo } : {}),
    ...(phoneNumberId ? { activeWabaPhoneNumberId: String(phoneNumberId).trim() } : {}),
    ...(companyId ? { activeCompanyId: String(companyId).trim() } : {})
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

  const candidateContextIds = [
    messageObj.reply_to,
    messageObj.reply_data?.id,
    messageObj.data?.context?.id,
    messageObj.context?.id,
    messageObj.context?.message_id,
    messageObj.context_id,
    messageObj.data?.context_message_id,
    rawPayload?.reply_to,
    rawPayload?.payload?.reply_to,
    rawPayload?.reply_data?.id,
    rawPayload?.payload?.reply_data?.id,
    rawPayload?.data?.context?.id,
    rawPayload?.payload?.data?.context?.id,
    rawPayload?.context?.id
  ].filter(id => id && typeof id === 'string' && id.trim().length > 0)
   .map(id => id.trim());

  const uniqueCandidateIds = [...new Set(candidateContextIds)];

  let parentMsg = null;
  if (uniqueCandidateIds.length > 0) {
    try {
      parentMsg = await Message.findOne({
        $or: [
          { myoperatorMessageId: { $in: uniqueCandidateIds } },
          { wabaMessageId: { $in: uniqueCandidateIds } }
        ]
      }).sort({ createdAt: -1 }).lean();
    } catch (findErr) {
      console.warn('[Webhook ReplyTo Lookup Warning]:', findErr.message);
    }
  }

  if (parentMsg) {
    const isOut = parentMsg.direction === 'outgoing';
    replyToData = {
      messageId: parentMsg._id.toString(),
      senderName: isOut ? 'You' : (contact.name || 'Lead'),
      content: parentMsg.content || (parentMsg.mediaUrl ? '[Media]' : ''),
      mediaUrl: parentMsg.mediaUrl || null
    };
  } else {
    const replyData = messageObj.reply_data || rawPayload?.payload?.reply_data || rawPayload?.reply_data;
    const isReply = messageObj.is_reply || rawPayload?.payload?.is_reply || Boolean(replyData) || uniqueCandidateIds.length > 0;

    if (isReply && (replyData || uniqueCandidateIds.length > 0)) {
      let extractedContent = '';
      let extractedMediaUrl = null;
      let senderName = 'You';

      if (replyData) {
        const rData = replyData.data || {};
        if (typeof rData.body === 'string') {
          extractedContent = rData.body;
        } else if (rData.body?.context) {
          extractedContent = rData.body.context;
        } else if (typeof rData.text === 'string') {
          extractedContent = rData.text;
        } else if (rData.caption) {
          extractedContent = rData.caption;
        } else if (replyData.type === 'template' && (rData.name || replyData.name)) {
          extractedContent = `[Template] ${rData.name || replyData.name}`;
        } else if (replyData.type === 'image') {
          extractedContent = rData.caption || '[Image]';
        } else if (replyData.type === 'document') {
          extractedContent = rData.filename || rData.caption || '[Document]';
        } else if (replyData.type === 'video') {
          extractedContent = rData.caption || '[Video]';
        } else if (replyData.type === 'audio') {
          extractedContent = '[Audio]';
        }
        extractedMediaUrl = rData.media_url || rData.url || rData.link || null;
      }

      const contextFrom = messageObj.data?.context?.from || rawPayload?.payload?.data?.context?.from || messageObj.context?.from;
      if (contextFrom) {
        const cleanContextFrom = contextFrom.replace(/\D/g, '').replace(/^91/, '');
        const cleanContactPhone = (contact.phone || '').replace(/\D/g, '').replace(/^91/, '');
        if (cleanContactPhone && cleanContextFrom === cleanContactPhone) {
          senderName = contact.name || 'Lead';
        } else {
          senderName = 'You';
        }
      }

      const primaryContextId = uniqueCandidateIds[0] || (replyData?.id ? String(replyData.id) : null);
      if (extractedContent || extractedMediaUrl || primaryContextId) {
        replyToData = {
          messageId: primaryContextId || null,
          senderName: senderName,
          content: extractedContent || (extractedMediaUrl ? '[Media]' : ''),
          mediaUrl: extractedMediaUrl
        };
      }
    }
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

  const targetAgentId = contact?.assignedTo || conversation?.assignedTo;
  if (targetAgentId) {
    const agentIdStr = targetAgentId._id ? targetAgentId._id.toString() : targetAgentId.toString();
    wsService.sendToUser(agentIdStr, broadcastPayload);
  }
  wsService.broadcastToRoles(['admin'], broadcastPayload);
  console.log(`[MyOperator Webhook] ✅ Broadcasted real-time NEW_MESSAGE for ${cleanPhone} to agent ${targetAgentId || 'NONE (Unassigned - Admin only)'}`);
}

/**
 * Message Delivery & Status Update Processor
 */
async function processMessageStatusUpdate({ messageId, status, wabaMessageId, errorReason }) {
  if (!messageId && !wabaMessageId) return;

  const cleanStatus = (status || '').toString().toLowerCase().trim();
  const cleanId = messageId ? messageId.toString().trim() : null;
  const cleanWaba = wabaMessageId ? wabaMessageId.toString().trim() : null;

  const orQueries = [];
  if (cleanId) {
    orQueries.push({ myoperatorMessageId: cleanId });
    orQueries.push({ wabaMessageId: cleanId });
  }
  if (cleanWaba) {
    orQueries.push({ wabaMessageId: cleanWaba });
    orQueries.push({ myoperatorMessageId: cleanWaba });
  }

  const updateFields = {};
  if (cleanStatus) updateFields.status = cleanStatus;
  if (cleanWaba) updateFields.wabaMessageId = cleanWaba;
  if (errorReason) updateFields.errorReason = errorReason;

  const updatedMsg = await Message.findOneAndUpdate(
    { $or: orQueries },
    { $set: updateFields },
    { returnDocument: 'after' }
  );

  if (updatedMsg) {
    const broadcastPayload = {
      type: 'MESSAGE_STATUS_UPDATED',
      data: {
        conversationId: updatedMsg.conversationId,
        messageId: updatedMsg._id,
        status: cleanStatus || updatedMsg.status,
        errorReason: errorReason || updatedMsg.errorReason
      }
    };
    try {
      const relatedConv = await Conversation.findById(updatedMsg.conversationId).select('assignedTo contactId').populate('contactId', 'assignedTo').lean();
      const targetAgentId = relatedConv?.assignedTo || relatedConv?.contactId?.assignedTo;
      if (targetAgentId) {
        const agentIdStr = targetAgentId._id ? targetAgentId._id.toString() : targetAgentId.toString();
        wsService.sendToUser(agentIdStr, broadcastPayload);
      }
    } catch (_) {}
    wsService.broadcastToRoles(['admin'], broadcastPayload);
    console.log(`[MyOperator Webhook] ✅ Message ${cleanId || cleanWaba} status updated to ${cleanStatus}`);
  }
}

module.exports = { handleWebhook };

