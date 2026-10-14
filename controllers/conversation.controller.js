const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const Note = require('../models/Note');
const User = require('../models/User');
const CannedResponse = require('../models/CannedResponse');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const myoperatorService = require('../services/myoperator.service');
const wsService = require('../services/websocket.service');
const contactSyncService = require('../services/contactSync.service');
const { normalizeIndianPhone, getPhoneQueryVariants } = require('../utils/phone');

// Get all conversations with pagination, role checks, and tab filtering
const getConversations = async (req, res) => {
  try {
    const { page = 1, limit = 500, search = '', status = 'open', tab = 'all', agentId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];

    if (status && status !== 'all' && status.trim() !== '') {
      if (status === 'open') {
        conditions.push({
          $or: [
            { status: 'open' },
            { status: { $exists: false } },
            { status: null }
          ]
        });
      } else {
        conditions.push({ status: status });
      }
    }

    // Role-based security filters: sales agents see only their assigned contacts/conversations, admin can filter by agentId or unassigned
    let agentFilterCondition = null;
    const targetAgent = req.user.role === 'sales' ? req.user.id : (req.user.role === 'admin' ? agentId : null);

    if (targetAgent && targetAgent !== 'all') {
      if (targetAgent === 'unassigned') {
        const assignedContactIds = await Contact.find({ assignedTo: { $ne: null } }).distinct('_id');
        const assignedUsers = await User.find({ assignedAgent: { $ne: null } }).select('phoneNumber').lean();
        const userPhones = assignedUsers.map(u => normalizeIndianPhone(u.phoneNumber)).filter(Boolean);
        const phoneVariants = userPhones.flatMap(p => getPhoneQueryVariants(p));
        const userAssignedContactIds = phoneVariants.length > 0
          ? await Contact.find({ phone: { $in: phoneVariants } }).distinct('_id')
          : [];
        const allAssignedContactIds = Array.from(new Set([...assignedContactIds.map(String), ...userAssignedContactIds.map(String)]));

        agentFilterCondition = {
          $and: [
            { $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }] },
            ...(allAssignedContactIds.length > 0 ? [{ contactId: { $nin: allAssignedContactIds } }] : [])
          ]
        };
      } else if (mongoose.Types.ObjectId.isValid(targetAgent)) {
        const agentObjId = new mongoose.Types.ObjectId(targetAgent);
        const assignedUsers = await User.find({ assignedAgent: agentObjId }).select('phoneNumber').lean();
        const userPhones = assignedUsers.map(u => normalizeIndianPhone(u.phoneNumber)).filter(Boolean);
        const phoneVariants = userPhones.flatMap(p => getPhoneQueryVariants(p));

        const assignedContactIds = await Contact.find({
          $or: [
            { assignedTo: agentObjId },
            ...(phoneVariants.length > 0 ? [{ phone: { $in: phoneVariants } }] : [])
          ]
        }).distinct('_id');

        agentFilterCondition = {
          $or: [
            { assignedTo: agentObjId },
            ...(assignedContactIds.length > 0 ? [{ contactId: { $in: assignedContactIds } }] : [])
          ]
        };
      }
    }

    if (agentFilterCondition) {
      conditions.push(agentFilterCondition);
    }

    // Tab-based filtering: 'all', 'active', 'leads', 'dealers', 'unread'
    if (tab === 'active') {
      // 🟢 WhatsApp 24-Hour Active Messaging Window filter
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      conditions.push({ lastIncomingMessageAt: { $gte: twentyFourHoursAgo } });
    } else if (tab === 'leads') {
      conditions.push({
        $or: [
          { contactType: 'lead' },
          { contactType: { $exists: false } },
          { contactType: null }
        ]
      });
    } else if (tab === 'dealers') {
      conditions.push({ contactType: 'dealer' });
    } else if (tab === 'unread') {
      conditions.push({ unreadCount: { $gt: 0 } });
    }

    // Apply Search Filters by customer name, phone number, or shop name
    if (search && search.trim() !== '') {
      const cleanSearch = search.trim();
      const phoneVariants = getPhoneQueryVariants(cleanSearch);
      const clean10 = normalizeIndianPhone(cleanSearch);

      const matchingContacts = await Contact.find({
        $or: [
          { name: { $regex: cleanSearch, $options: 'i' } },
          { tags: { $regex: cleanSearch, $options: 'i' } },
          ...(phoneVariants.length > 0 ? [{ phone: { $in: phoneVariants } }] : []),
          ...(clean10 ? [{ phone: { $regex: clean10 } }] : [])
        ]
      }).select('_id').lean();
      const contactIds = matchingContacts.map(c => c._id);
      conditions.push({ contactId: { $in: contactIds } });
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    // Base conditions for role isolation tab counts (independent of specific tab filter)
    const baseConditions = [];
    if (status && status !== 'all' && status.trim() !== '') {
      if (status === 'open') {
        baseConditions.push({
          $or: [
            { status: 'open' },
            { status: { $exists: false } },
            { status: null }
          ]
        });
      } else {
        baseConditions.push({ status: status });
      }
    }
    if (agentFilterCondition) {
      baseConditions.push(agentFilterCondition);
    }
    const baseQuery = baseConditions.length > 0 ? { $and: baseConditions } : {};

    // Lightning-fast parallel execution: Lean conversation query + Single aggregation facet
    let [conversations, facetResult, total] = await Promise.all([
      Conversation.find(query)
        .populate('contactId')
        .populate('assignedTo', 'firstName lastName email phoneNumber')
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Conversation.aggregate([
        { $match: baseQuery },
        {
          $facet: {
            all: [{ $count: 'count' }],
            leads: [
              { $match: { $or: [{ contactType: 'lead' }, { contactType: { $exists: false } }, { contactType: null }] } },
              { $count: 'count' }
            ],
            dealers: [
              { $match: { contactType: 'dealer' } },
              { $count: 'count' }
            ],
            active: [
              { $match: { lastIncomingMessageAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
              { $count: 'count' }
            ],
            unread: [
              { $match: { unreadCount: { $gt: 0 } } },
              { $count: 'count' }
            ]
          }
        }
      ]),
      Conversation.countDocuments(query)
    ]);

    // Auto-sync fallback: If 0 conversations found and no search query, kick off instant sync and re-query
    if (total === 0 && search === '' && page == 1 && tab === 'all') {
      try {
        if (req.user.role === 'sales') {
          await contactSyncService.syncAllAssignedUsersForAgent(req.user.id, false);
        } else {
          await contactSyncService.syncAllUsers(false);
        }
        conversations = await Conversation.find(query)
          .populate('contactId')
          .populate('assignedTo', 'firstName lastName email phoneNumber')
          .sort({ lastMessageAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean();
        total = conversations.length;
      } catch (syncErr) {
        console.error('[getConversations] Auto-sync fallback error:', syncErr.message);
      }
    }

    const countsFacet = facetResult?.[0] || {};
    const allCount = countsFacet.all?.[0]?.count || 0;
    const leadsCount = countsFacet.leads?.[0]?.count || 0;
    const dealersCount = countsFacet.dealers?.[0]?.count || 0;
    const activeCount = countsFacet.active?.[0]?.count || 0;
    const unreadCount = countsFacet.unread?.[0]?.count || 0;

    // Guaranteed in-memory deduplication by canonical 10-digit phone
    const seenPhones = new Set();
    const dedupedConversations = [];
    for (const conv of conversations) {
      const p = conv.contactPhone || conv.contactId?.phone;
      const clean10 = normalizeIndianPhone(p);
      if (clean10) {
        if (seenPhones.has(clean10)) {
          contactSyncService.deduplicateContactsAndConversations().catch(() => {});
          continue;
        }
        seenPhones.add(clean10);
      }
      dedupedConversations.push(conv);
    }

    // Enrich with soft-deleted status and real-time assignedAgent from User collection for complete consistency
    try {
      const cleanPhones = dedupedConversations
        .map(c => normalizeIndianPhone(c.contactPhone || c.contactId?.phone))
        .filter(Boolean);

      if (cleanPhones.length > 0) {
        const regexList = cleanPhones.map(p => new RegExp('^' + p));
        const matchedUsers = await User.find({
          phoneNumber: { $in: regexList }
        }).select('phoneNumber isDeleted assignedAgent')
          .populate('assignedAgent', 'firstName lastName email phoneNumber role')
          .lean();

        const userMap = new Map();
        for (const u of matchedUsers) {
          const raw = String(u.phoneNumber || '').split('_deleted_')[0];
          const clean = normalizeIndianPhone(raw);
          if (clean && !userMap.has(clean)) {
            userMap.set(clean, u);
          }
        }

        for (const conv of dedupedConversations) {
          const p10 = normalizeIndianPhone(conv.contactPhone || conv.contactId?.phone);
          const matchedUser = p10 ? userMap.get(p10) : null;

          // 1. Soft-deleted check
          const isUserDeleted = matchedUser?.isDeleted === true;
          const isAlreadyMarkedDeleted = conv.isDeleted === true ||
            conv.contactId?.isDeleted === true ||
            (Array.isArray(conv.contactId?.tags) && conv.contactId.tags.includes('deleted'));

          if (isUserDeleted || isAlreadyMarkedDeleted) {
            conv.isDeleted = true;
            if (conv.contactId) {
              conv.contactId.isDeleted = true;
            }
          }

          // 2. Real-time Assigned Agent sync from Lead profile in CRM
          if (matchedUser?.assignedAgent && (matchedUser.assignedAgent.role === 'sales' || matchedUser.assignedAgent.role === 'admin')) {
            conv.assignedTo = matchedUser.assignedAgent;
            if (conv.contactId) {
              conv.contactId.assignedTo = matchedUser.assignedAgent._id;
            }
          } else if (conv.assignedTo && conv.assignedTo.role !== 'sales' && conv.assignedTo.role !== 'admin') {
            // Guard: Clear out any invalid non-sales users that may have been saved previously
            conv.assignedTo = null;
          }
        }
      }
    } catch (enrichErr) {
      console.warn('[getConversations] Enrichment warning:', enrichErr.message);
    }

    res.json({
      success: true,
      data: dedupedConversations,
      pagination: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
      counts: {
        all: allCount,
        leads: leadsCount,
        dealers: dealersCount,
        active: activeCount,
        unread: unreadCount
      }
    });

    // Asynchronous background periodic refresh (governed by 10-minute cooldown cache)
    if (page == 1 && search === '') {
      if (req.user.role === 'sales') {
        contactSyncService.syncAllAssignedUsersForAgent(req.user.id, false).catch(() => {});
      } else {
        contactSyncService.syncAllUsers(false).catch(() => {});
      }
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * On-demand Roster Sync Endpoint (Syncs all leads/dealers and WhatsApp messages in CRM)
 */
const syncRoster = async (req, res) => {
  try {
    let result;
    if (req.user.role === 'sales') {
      result = await contactSyncService.syncAllAssignedUsersForAgent(req.user.id, true);
    } else {
      const targetAgentId = req.query.agentId || req.body.agentId;
      if (targetAgentId) {
        result = await contactSyncService.syncAllAssignedUsersForAgent(targetAgentId, true);
      } else {
        result = await contactSyncService.syncAllUsers(true);
      }
    }

    // Deduplicate & merge any redundant contact or conversation entries
    await contactSyncService.deduplicateContactsAndConversations().catch(() => {});

    // Also pull latest WhatsApp messages from MyOperator
    try {
      await myoperatorService.syncAllMessagesFromMyOperator();
    } catch (_) {}

    res.json({
      success: true,
      message: `Roster sync and deduplication completed: ${result.synced || 0} contacts synchronized`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Sends read receipts to Meta/MyOperator for incoming unread messages
 * so the customer sees the blue double checkmarks on WhatsApp
 */
const sendReadReceiptsForConversation = async (conversationId) => {
  try {
    const incomingMessages = await Message.find({
      conversationId,
      direction: 'incoming'
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('_id myoperatorMessageId wabaMessageId status');

    if (incomingMessages && incomingMessages.length > 0) {
      await Message.updateMany(
        { _id: { $in: incomingMessages.map(m => m._id) } },
        { status: 'read' }
      );

      for (const msg of incomingMessages) {
        if (msg.wabaMessageId || msg.myoperatorMessageId) {
          myoperatorService.markMessageAsRead({
            messageId: msg.myoperatorMessageId,
            wabaMessageId: msg.wabaMessageId
          }).catch((err) => {
            console.warn('[markMessageAsRead error]:', err.message);
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Read Receipt Helper Error]:', err.message);
  }
};

// Retrieve Messages (Infinite scroll / Paginated)
const getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 30 } = req.query;
    const skip = (page - 1) * limit;

    const conversation = await Conversation.findById(id).populate('contactId');
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Role Security: Sales agents can ONLY view messages for leads/dealers assigned to them or unassigned
    if (req.user.role === 'sales') {
      const isAssignedConv = conversation.assignedTo && String(conversation.assignedTo) === String(req.user.id);
      const isAssignedContact = conversation.contactId?.assignedTo && String(conversation.contactId.assignedTo) === String(req.user.id);
      const isUnassigned = !conversation.assignedTo && !conversation.contactId?.assignedTo;
      if (!isAssignedConv && !isAssignedContact && !isUnassigned) {
        return res.status(403).json({ success: false, message: 'Access Denied: You can only view chats assigned to you.' });
      }
    }

    // Clean unread count and trigger blue tick read receipts on customer's WhatsApp
    await Conversation.findByIdAndUpdate(id, { unreadCount: 0 });
    sendReadReceiptsForConversation(id).catch(() => {});
    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CONVERSATION_READ',
      data: { conversationId: id }
    });

    const messages = await Message.find({ conversationId: id })
      .populate('sentBy', 'firstName lastName')
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Sort strictly chronological ascending
    messages.sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return String(a._id).localeCompare(String(b._id));
    });

    // Auto-heal conversation's lastMessage, lastMessageAt, and lastIncomingMessageAt if needed
    if (messages.length > 0) {
      const latestMsg = messages[messages.length - 1];
      const latestIncoming = [...messages].reverse().find(m => m.direction === 'incoming');
      const healFields = {};
      if (latestMsg) {
        const latestMsgType = ['text', 'image', 'document', 'audio', 'video', 'template'].includes(latestMsg.type) ? latestMsg.type : 'text';
        const latestContent = latestMsg.content || (latestMsg.mediaUrl ? `[${latestMsgType}]` : '');
        healFields.lastMessage = {
          type: latestMsgType,
          content: latestContent,
          mediaUrl: latestMsg.mediaUrl
        };
        healFields.lastMessageAt = latestMsg.createdAt;
      }
      if (latestIncoming) {
        if (!conversation.lastIncomingMessageAt || new Date(latestIncoming.createdAt).getTime() > new Date(conversation.lastIncomingMessageAt).getTime()) {
          healFields.lastIncomingMessageAt = latestIncoming.createdAt;
        }
      }
      if (Object.keys(healFields).length > 0) {
        Conversation.findByIdAndUpdate(id, { $set: healFields }).catch(() => {});
      }
    }

    res.json({
      success: true,
      data: messages,
      page: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send message via API (Text or Media)
const sendConversationMessage = async (req, res, next) => {
  try {
    const { conversationId, content, mediaUrl, templateName, replyTo } = req.body;

    const rawType = req.body.type || (templateName ? 'template' : 'text');
    const rawBodyValues = req.body.bodyValues || req.body.templateParams || req.body.parameters || req.body.variables || [];
    const languageCode = req.body.languageCode || req.body.language || req.body.lang || 'en';

    let bodyValues = [];
    if (Array.isArray(rawBodyValues)) {
      bodyValues = rawBodyValues.filter(v => v !== null && v !== undefined).map(v => String(v).trim());
    } else if (rawBodyValues && typeof rawBodyValues === 'object') {
      bodyValues = Object.values(rawBodyValues).filter(v => v !== null && v !== undefined).map(v => String(v).trim());
    } else if (typeof rawBodyValues === 'string' && rawBodyValues.trim() !== '') {
      try {
        const parsed = JSON.parse(rawBodyValues);
        if (Array.isArray(parsed)) {
          bodyValues = parsed.map(v => String(v).trim());
        } else {
          bodyValues = [rawBodyValues.trim()];
        }
      } catch (_) {
        bodyValues = rawBodyValues.split(',').map(s => s.trim());
      }
    }

    const conversation = await Conversation.findById(conversationId).populate('contactId');
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Role Security: Sales agents can ONLY send messages to leads/dealers assigned to them or unassigned
    if (req.user.role === 'sales') {
      const isAssignedConv = conversation.assignedTo && String(conversation.assignedTo) === String(req.user.id);
      const isAssignedContact = conversation.contactId?.assignedTo && String(conversation.contactId.assignedTo) === String(req.user.id);

      let isAssignedLeadUser = false;
      const cleanPhone = normalizeIndianPhone(conversation.contactPhone || conversation.contactId?.phone);
      if (cleanPhone) {
        const phoneVariants = getPhoneQueryVariants(cleanPhone);
        const leadUser = await User.findOne({
          phoneNumber: { $in: phoneVariants }
        }).select('assignedAgent').lean();
        if (leadUser?.assignedAgent && String(leadUser.assignedAgent) === String(req.user.id)) {
          isAssignedLeadUser = true;
        }
      }

      const isUnassigned = (!conversation.assignedTo && !conversation.contactId?.assignedTo);

      if (!isAssignedConv && !isAssignedContact && !isAssignedLeadUser && !isUnassigned) {
        return res.status(403).json({ success: false, message: 'Access Denied: You can only chat with leads assigned to you.' });
      }

      // Auto-assign conversation and contact to this sales agent if unassigned or lead matches
      if (!isAssignedConv || !isAssignedContact) {
        conversation.assignedTo = req.user.id;
        await conversation.save();
        if (conversation.contactId && String(conversation.contactId.assignedTo) !== String(req.user.id)) {
          await Contact.findByIdAndUpdate(conversation.contactId._id || conversation.contactId, { assignedTo: req.user.id });
        }
      }
    }

    const selectedLang = languageCode || conversation.contactId?.preferredLanguage || 'en';

    let normalizedType = (rawType || 'text').toLowerCase();
    if (mediaUrl && normalizedType !== 'template') {
      const urlLower = mediaUrl.toString().toLowerCase();
      if (normalizedType === 'document' || urlLower.endsWith('.pdf') || urlLower.endsWith('.csv') || urlLower.endsWith('.xlsx') || urlLower.endsWith('.xls') || urlLower.endsWith('.docx') || urlLower.endsWith('.doc') || urlLower.endsWith('.txt') || urlLower.endsWith('.zip')) {
        normalizedType = 'document';
      } else if (normalizedType === 'video' || urlLower.endsWith('.mp4')) {
        normalizedType = 'video';
      } else if (normalizedType === 'audio' || urlLower.endsWith('.mp3') || urlLower.endsWith('.ogg')) {
        normalizedType = 'audio';
      } else if (normalizedType === 'text' || !normalizedType) {
        normalizedType = 'image';
      }
    }

    // Extract contextual reply message ID if quoting another message
    let contextMessageId = null;
    let resolvedReplyTo = null;

    if (replyTo && (replyTo.myoperatorMessageId || replyTo.messageId || replyTo.content)) {
      const rawContextId = replyTo.myoperatorMessageId || replyTo.messageId;
      if (rawContextId) {
        try {
          const mongoose = require('mongoose');
          const parentMsg = await Message.findOne({
            $or: [
              ...(mongoose.Types.ObjectId.isValid(rawContextId) ? [{ _id: rawContextId }] : []),
              { myoperatorMessageId: rawContextId },
              { wabaMessageId: rawContextId }
            ]
          }).lean();
          if (parentMsg) {
            contextMessageId = (parentMsg.myoperatorMessageId && parentMsg.myoperatorMessageId.length <= 40 && !parentMsg.myoperatorMessageId.startsWith('wamid.'))
              ? parentMsg.myoperatorMessageId
              : (parentMsg.wabaMessageId || parentMsg.myoperatorMessageId || rawContextId);
            resolvedReplyTo = {
              messageId: parentMsg._id.toString(),
              senderName: replyTo.senderName || (parentMsg.direction === 'outgoing' ? 'You' : (conversation.contactId?.name || 'Lead')),
              content: replyTo.content || parentMsg.content || (parentMsg.mediaUrl ? '[Media]' : ''),
              mediaUrl: replyTo.mediaUrl || parentMsg.mediaUrl
            };
          } else if (typeof rawContextId === 'string' && rawContextId.length > 0) {
            contextMessageId = rawContextId.trim();
          }
        } catch (_) {
          if (typeof rawContextId === 'string' && rawContextId.length > 0) {
            contextMessageId = rawContextId.trim();
          }
        }
      }

      if (!resolvedReplyTo && (replyTo.content !== undefined || replyTo.mediaUrl || replyTo.messageId)) {
        resolvedReplyTo = {
          messageId: replyTo.messageId,
          senderName: replyTo.senderName || (replyTo.direction === 'outgoing' ? 'You' : (conversation.contactId?.name || 'Lead')),
          content: replyTo.content || (replyTo.mediaUrl ? '[Media]' : ''),
          mediaUrl: replyTo.mediaUrl
        };
      }
    }

    // Dispatches message to MyOperator WABA API with dedicated agent credentials
    const myopResponse = await myoperatorService.sendMessage({
      agentId: req.user.id,
      assignedAgentId: conversation.assignedTo || conversation.contactId?.assignedTo,
      activeWabaPhoneNumberId: conversation.activeWabaPhoneNumberId,
      activeCompanyId: conversation.activeCompanyId,
      lastIncomingMessageAt: conversation.lastIncomingMessageAt,
      phone: conversation.contactId.phone,
      type: normalizedType,
      mediaType: normalizedType,
      textBody: content,
      mediaUrl,
      templateName,
      bodyValues,
      languageCode: selectedLang,
      contextMessageId,
      replyToMessageId: contextMessageId
    });

    const myopMsgId =
      myopResponse?.data?.message_id ||
      myopResponse?.data?.id ||
      myopResponse?.message_id ||
      myopResponse?.id;
    const wabaMsgId =
      myopResponse?.data?.metadata?.waba_msg_id ||
      myopResponse?.metadata?.waba_msg_id;
    const resolvedMyopId = (myopMsgId && String(myopMsgId).length <= 40 && !String(myopMsgId).startsWith('wamid.'))
      ? String(myopMsgId).trim()
      : (wabaMsgId ? String(wabaMsgId).trim() : (myopMsgId ? String(myopMsgId).trim() : undefined));

    // Resolve actual message text if sending a template
    let resolvedContent = content;
    if (normalizedType === 'template' || templateName) {
      if (!resolvedContent || resolvedContent.startsWith('[Template]')) {
        try {
          const tpl = await WhatsAppTemplate.findOne({
            name: templateName
          }).sort({ isGlobal: 1 });

          if (tpl && tpl.body) {
            let text = tpl.body;
            if (Array.isArray(bodyValues)) {
              bodyValues.forEach((val, idx) => {
                text = text.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), String(val));
              });
            }
            resolvedContent = text;
          } else {
            resolvedContent = content || `[Template] ${templateName}`;
          }
        } catch (_) {
          resolvedContent = content || `[Template] ${templateName}`;
        }
      }
    }

    const normalizedMsgType = (normalizedType || 'text').toLowerCase();
    const safeContent = resolvedContent || (templateName ? `[Template] ${templateName}` : '');

    const messageData = {
      conversationId: conversation._id,
      contactId: conversation.contactId._id,
      direction: 'outgoing',
      type: normalizedMsgType,
      content: safeContent,
      mediaUrl,
      sentBy: req.user.id,
      status: 'sent'
    };

    if (resolvedReplyTo) {
      messageData.replyTo = resolvedReplyTo;
    }

    if (resolvedMyopId) {
      messageData.myoperatorMessageId = resolvedMyopId;
    }
    if (wabaMsgId) {
      messageData.wabaMessageId = wabaMsgId.toString();
    }

    const message = new Message(messageData);
    await message.save();

    // Update conversation metadata
    conversation.lastMessage = { type: normalizedMsgType, content: safeContent, mediaUrl };
    conversation.lastMessageAt = new Date();
    conversation.unreadCount = 0;
    await conversation.save();

    // Broadcast new message update via Native WebSockets
    try {
      const populatedMessage = await Message.findById(message._id).populate('sentBy', 'firstName lastName');
      const broadcastPayload = {
        type: 'NEW_MESSAGE',
        data: {
          conversation: await conversation.populate(['contactId', 'assignedTo']),
          message: populatedMessage
        }
      };

      if (conversation.assignedTo) {
        wsService.sendToUser(conversation.assignedTo.toString(), broadcastPayload);
      }
      wsService.broadcastToRoles(['admin'], broadcastPayload);
    } catch (wsErr) {
      console.warn('[WS Broadcast Note]:', wsErr.message);
    }

    res.json({ success: true, data: message });
  } catch (error) {
    console.error('[sendConversationMessage Error]:', error);
    const statusCode = error.statusCode || (error.response?.status) || 500;
    const isWindowExpired = error.code === 'WINDOW_EXPIRED' ||
      (typeof error.message === 'string' && (error.message.includes('24-hour') || error.message.includes('24 hours')));

    res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({
      success: false,
      code: isWindowExpired ? 'WINDOW_EXPIRED' : (error.code || 'SEND_FAILED'),
      message: error.message || 'Failed to send message'
    });
  }
};

// Manual lead reassignment (Admin only)
const assignConversation = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized permission level' });
    }

    const { conversationId, agentId } = req.body;

    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { assignedTo: agentId },
      { new: true }
    ).populate(['contactId', 'assignedTo']);

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Update Contact assignment as well
    if (conversation.contactId) {
      await Contact.findByIdAndUpdate(conversation.contactId._id, { assignedTo: agentId });

      // Also sync User if registered
      if (conversation.contactId.phone) {
        const cleanPhone = conversation.contactId.phone.replace(/[^\d]/g, '');
        const targetPhone = cleanPhone.startsWith('91') && cleanPhone.length === 12 ? cleanPhone.slice(2) : cleanPhone;
        await User.updateMany(
          {
            $or: [
              { phoneNumber: targetPhone },
              { phoneNumber: `91${targetPhone}` },
              { phoneNumber: `+91${targetPhone}` }
            ]
          },
          {
            $set: {
              assignedAgent: agentId || null,
              assignedAt: agentId ? new Date() : null
            }
          }
        );
      }
    }

    res.json({ success: true, message: 'Conversation assigned successfully', data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Add internal Note & sync with Lead/Dealer User Profile
const addNote = async (req, res) => {
  try {
    const { conversationId, note } = req.body;

    // Find linked Contact and User profile (Lead/Dealer) to sync notes & notesHistory
    const conversation = await Conversation.findById(conversationId).populate('contactId');
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (req.user.role === 'sales') {
      const isAssignedConv = conversation.assignedTo && String(conversation.assignedTo) === String(req.user.id);
      const isAssignedContact = conversation.contactId?.assignedTo && String(conversation.contactId.assignedTo) === String(req.user.id);
      const isUnassigned = !conversation.assignedTo && !conversation.contactId?.assignedTo;
      if (!isAssignedConv && !isAssignedContact && !isUnassigned) {
        return res.status(403).json({ success: false, message: 'Access Denied: You can only add notes to leads assigned to you.' });
      }
    }

    const newNote = new Note({
      conversationId,
      note,
      createdBy: req.user.id
    });
    await newNote.save();

    if (conversation && conversation.contactId) {
      const contactPhone = conversation.contactId.phone;
      if (contactPhone) {
        const cleanPhone = contactPhone.replace(/[^\d]/g, '').replace(/^91/, '');
        
        const userDoc = await User.findOne({
          $or: [
            { phoneNumber: cleanPhone },
            { phoneNumber: `91${cleanPhone}` },
            { phoneNumber: `+91${cleanPhone}` },
            { phoneNumber: contactPhone }
          ]
        });

        if (userDoc) {
          userDoc.notes = note;
          const adminUser = await User.findById(req.user.id);
          const adminName = adminUser
            ? `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || adminUser.name || 'Agent'
            : 'Agent';

          userDoc.notesHistory = userDoc.notesHistory || [];
          userDoc.notesHistory.push({
            title: 'WhatsApp CRM Note',
            note: note,
            adminId: req.user.id,
            adminName: adminName,
            author: adminName,
            createdAt: new Date(),
            type: 'general'
          });
          await userDoc.save();
        }
      }
    }

    res.status(201).json({ success: true, data: newNote });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Start or get conversation for a contact (explicitly initiated by agent/sales person)
const startConversation = async (req, res) => {
  try {
    let { phone, name } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    // Clean phone number to canonical 10 digits
    const cleanPhone = normalizeIndianPhone(phone);
    const phoneVariants = getPhoneQueryVariants(phone);

    // Check if there is an existing User (Lead/Dealer) with this phone number
    const existingUser = await User.findOne({
      $or: [
        { phoneNumber: { $in: phoneVariants } },
        { phoneNumber: cleanPhone },
        { phoneNumber: phone }
      ]
    }).populate('assignedAgent');

    // 1. Create or Find Contact
    let contact = await Contact.findOne({
      $or: [
        { phone: { $in: phoneVariants } },
        { phone: cleanPhone },
        { phone: phone }
      ]
    });

    let assignedAgentId = existingUser ? (existingUser.assignedAgent?._id || existingUser.assignedAgent) : null;

    if (!contact) {
      if (!assignedAgentId) {
        assignedAgentId = await myoperatorService.assignNextSalesAgent();
      }
      contact = new Contact({
        name: name || (existingUser ? `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() || existingUser.shopName : null) || `User ${cleanPhone.slice(-4)}`,
        phone: cleanPhone,
        assignedTo: assignedAgentId,
        tags: ['myoperator-lead']
      });
      await contact.save();
    } else {
      if (contact.phone !== cleanPhone && cleanPhone.length === 10) {
        contact.phone = cleanPhone;
        await contact.save();
      }
      // Sync: If the Contact exists but its assignment is different from the User's assignment, update it!
      if (existingUser && assignedAgentId && String(contact.assignedTo) !== String(assignedAgentId)) {
        contact.assignedTo = assignedAgentId;
        await contact.save();
      }
      const realName = name || (existingUser ? `${existingUser.firstName || ''} ${existingUser.lastName || ''}`.trim() || existingUser.shopName : null);
      if (realName && (!contact.name || contact.name === 'WhatsApp User' || contact.name.startsWith('User ') || /^\d+$/.test(contact.name))) {
        contact.name = realName;
        await contact.save();
      }
    }

    const isDealer = existingUser?.role === 'dealer' || (contact.tags || []).some(t => /dealer|retailer/i.test(t));
    const contactType = isDealer ? 'dealer' : 'lead';

    // 2. Create or Find Conversation
    let conversation = await Conversation.findOne({ contactId: contact._id });

    // Role Security Check: If a sales agent tries to start/access a conversation assigned to someone else
    if (req.user.role === 'sales') {
      if (conversation && conversation.assignedTo && String(conversation.assignedTo) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Access Denied: This lead/dealer is assigned to another sales agent.' });
      }
    }

    if (!conversation) {
      conversation = new Conversation({
        contactId: contact._id,
        assignedTo: contact.assignedTo || req.user.id,
        contactType: contactType,
        contactName: contact.name,
        contactPhone: cleanPhone,
        status: 'open'
      });
      await conversation.save();
    } else {
      conversation.contactType = contactType;
      conversation.contactName = contact.name;
      conversation.contactPhone = cleanPhone;
      // Sync Conversation's assignment to match Contact's assignment
      if (String(conversation.assignedTo) !== String(contact.assignedTo)) {
        conversation.assignedTo = contact.assignedTo;
      }
      await conversation.save();
    }

    let populated = await Conversation.findById(conversation._id)
      .populate('contactId')
      .populate('assignedTo', 'firstName lastName email')
      .lean();

    if (existingUser?.isDeleted) {
      populated.isDeleted = true;
      if (populated.contactId) populated.contactId.isDeleted = true;
    } else {
      const userDel = await User.findOne({
        phoneNumber: new RegExp('^' + cleanPhone),
        isDeleted: true
      }).select('isDeleted').lean();
      if (userDel) {
        populated.isDeleted = true;
        if (populated.contactId) populated.contactId.isDeleted = true;
      }
    }

    res.json({ success: true, data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateConversationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['open', 'closed', 'snoozed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const existingConv = await Conversation.findById(id);
    if (!existingConv) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Role Security: Sales agents can ONLY manage conversations assigned to them
    if (req.user.role === 'sales' && String(existingConv.assignedTo) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Access Denied: You can only update status for leads assigned to you.' });
    }

    const conversation = await Conversation.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).populate(['contactId', 'assignedTo']);

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateConversationLanguage = async (req, res) => {
  try {
    const { id } = req.params;
    const { preferredLanguage } = req.body;

    const validLanguages = ['en', 'hi', 'ta', 'te', 'mr', 'kn'];
    if (!validLanguages.includes(preferredLanguage)) {
      return res.status(400).json({ success: false, message: 'Invalid language code. Allowed: en, hi, ta, te, mr, kn' });
    }

    const conversation = await Conversation.findById(id).populate('contactId');
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    if (req.user.role === 'sales' && String(conversation.assignedTo) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Access Denied: You can only update language for leads assigned to you.' });
    }

    // Update Contact model preferredLanguage
    if (conversation.contactId) {
      await Contact.findByIdAndUpdate(conversation.contactId._id, { preferredLanguage });
      
      // Sync User model preferredLanguage if exists
      const cleanPhone = conversation.contactId.phone.replace(/[^\d]/g, '').replace(/^91/, '');
      await User.findOneAndUpdate(
        {
          $or: [
            { phoneNumber: cleanPhone },
            { phoneNumber: `91${cleanPhone}` },
            { phoneNumber: `+91${cleanPhone}` },
            { phoneNumber: conversation.contactId.phone }
          ]
        },
        { preferredLanguage }
      );
    }

    const updatedConv = await Conversation.findById(id)
      .populate('contactId')
      .populate('assignedTo', 'firstName lastName email');

    res.json({ success: true, data: updatedConv });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Fetch WhatsApp Templates (Merges DB records & MyOperator live API)
 */
const getTemplates = async (req, res) => {
  try {
    const dbTemplates = await WhatsAppTemplate.find().sort({ createdAt: -1 }).lean();
    let providerTemplates = [];
    try {
      providerTemplates = await myoperatorService.getTemplates();
    } catch (pErr) {
      console.warn('[MyOperator] Could not load live templates from provider:', pErr.message);
    }

    // Merge real database templates & live provider templates (no dummy mock data)
    const combined = [...dbTemplates];
    if (Array.isArray(providerTemplates)) {
      for (const pt of providerTemplates) {
        const name = pt.name || pt.element_name;
        if (name && !combined.some(c => c.name === name)) {
          combined.push({
            name,
            category: pt.category || 'UTILITY',
            language: pt.language || 'en',
            body: pt.body || pt.data?.body || (pt.components?.find(c => c.type === 'BODY')?.text) || name,
            status: pt.status || 'APPROVED',
            providerTemplateId: pt.id || pt.uuid,
            buttons: pt.buttons || []
          });
        }
      }
    }

    res.json({ success: true, data: combined });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a new WhatsApp Template and submit to MyOperator / Meta for approval
 */
const createTemplate = async (req, res) => {
  try {
    const {
      name,
      category = 'UTILITY',
      language = 'en',
      headerType = 'NONE',
      headerText = '',
      body,
      footer = '',
      buttons = [],
      sampleVariables = []
    } = req.body;

    if (!name || !body) {
      return res.status(400).json({ success: false, message: 'Template name and body are required' });
    }

    const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

    // Build standard Meta / WABA component payload
    const components = [];
    if (headerType === 'TEXT' && headerText) {
      components.push({ type: 'HEADER', format: 'TEXT', text: headerText });
    } else if (headerType === 'IMAGE') {
      components.push({ type: 'HEADER', format: 'IMAGE' });
    } else if (headerType === 'DOCUMENT') {
      components.push({ type: 'HEADER', format: 'DOCUMENT' });
    }

    components.push({ type: 'BODY', text: body });

    if (footer && footer.trim()) {
      components.push({ type: 'FOOTER', text: footer.trim() });
    }

    if (Array.isArray(buttons) && buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: buttons.map(b => ({
          type: b.type || 'QUICK_REPLY',
          text: b.text,
          ...(b.url && { url: b.url }),
          ...(b.phoneNumber && { phone_number: b.phoneNumber })
        }))
      });
    }

    const providerPayload = {
      name: cleanName,
      category: category.toUpperCase(),
      language,
      components
    };

    let providerResponse = null;
    let initialStatus = 'PENDING_APPROVAL';

    try {
      providerResponse = await myoperatorService.createTemplate(providerPayload);
      if (providerResponse?.status === 'APPROVED' || providerResponse?.status === 'approved') {
        initialStatus = 'APPROVED';
      }
    } catch (provErr) {
      console.warn('[MyOperator] Template submission queued or provider error:', provErr.message);
    }

    const templateDoc = await WhatsAppTemplate.create({
      name: cleanName,
      category: category.toUpperCase(),
      language,
      headerType,
      headerText,
      body,
      footer,
      buttons,
      sampleVariables,
      status: initialStatus,
      providerTemplateId: providerResponse?.id || providerResponse?.template_id || null,
      createdBy: req.user.id
    });

    res.json({
      success: true,
      message: 'Template submitted successfully and is awaiting approval',
      data: templateDoc
    });
  } catch (error) {
    console.error('[Create WhatsApp Template Error]:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a WhatsApp Template
 */
const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await WhatsAppTemplate.findById(id);
    
    if (template?.providerTemplateId) {
      try {
        await myoperatorService.deleteTemplate(template.providerTemplateId);
      } catch (_) {}
    }

    await WhatsAppTemplate.findByIdAndDelete(id);
    res.json({ success: true, message: 'Template removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get Canned Responses / Quick Replies
 */
const getCannedResponses = async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'sales') {
      // Sales agents see Global responses (created by Admin) + their own private ones
      query = {
        $or: [
          { isGlobal: true },
          { createdBy: req.user.id }
        ]
      };
    }
    const canned = await CannedResponse.find(query)
      .populate('createdBy', 'firstName lastName email role')
      .sort({ title: 1 })
      .lean();
    res.json({ success: true, data: canned });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a new Canned Response
 */
const createCannedResponse = async (req, res) => {
  try {
    const { title, shortcut, message, category = 'General', tags = [] } = req.body;
    if (!title || !shortcut || !message) {
      return res.status(400).json({ success: false, message: 'Title, shortcut, and message are required' });
    }

    const cleanShortcut = shortcut.startsWith('/') ? shortcut.trim().toLowerCase() : `/${shortcut.trim().toLowerCase()}`;
    const isAdmin = req.user.role === 'admin';
    const isGlobal = isAdmin;

    // Check duplicate shortcut within visible scope
    const duplicateQuery = isAdmin
      ? { shortcut: cleanShortcut }
      : {
          shortcut: cleanShortcut,
          $or: [{ isGlobal: true }, { createdBy: req.user.id }]
        };

    const existing = await CannedResponse.findOne(duplicateQuery);
    if (existing) {
      return res.status(400).json({ success: false, message: `Shortcut ${cleanShortcut} already exists in your workspace` });
    }

    const item = await CannedResponse.create({
      title: title.trim(),
      shortcut: cleanShortcut,
      message: message.trim(),
      category,
      tags,
      isGlobal,
      createdBy: req.user.id
    });

    const populated = await CannedResponse.findById(item._id).populate('createdBy', 'firstName lastName email role');
    res.json({ success: true, message: 'Canned response created successfully', data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update an existing Canned Response
 */
const updateCannedResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, shortcut, message, category, tags } = req.body;

    const existing = await CannedResponse.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Canned response not found' });
    }

    // Role check: sales agents can only update their own responses
    if (req.user.role === 'sales' && existing.createdBy && existing.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this canned response' });
    }

    const updateFields = {};
    if (title) updateFields.title = title.trim();
    if (shortcut) {
      updateFields.shortcut = shortcut.startsWith('/') ? shortcut.trim().toLowerCase() : `/${shortcut.trim().toLowerCase()}`;
    }
    if (message) updateFields.message = message.trim();
    if (category) updateFields.category = category;
    if (tags) updateFields.tags = tags;

    const updated = await CannedResponse.findByIdAndUpdate(id, updateFields, { new: true })
      .populate('createdBy', 'firstName lastName email role');

    res.json({ success: true, message: 'Canned response updated', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a Canned Response
 */
const deleteCannedResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await CannedResponse.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Canned response not found' });
    }

    // Role check: sales agents can only delete their own responses
    if (req.user.role === 'sales' && existing.createdBy && existing.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this canned response' });
    }

    await CannedResponse.findByIdAndDelete(id);
    res.json({ success: true, message: 'Canned response deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mark a conversation as read (resets unreadCount to 0)
 */
const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findByIdAndUpdate(
      id,
      { unreadCount: 0 },
      { returnDocument: 'after' }
    ).populate(['contactId', 'assignedTo']);

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    sendReadReceiptsForConversation(id).catch(() => {});

    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CONVERSATION_READ',
      data: {
        conversationId: id,
        conversation
      }
    });

    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mark a conversation as unread (manually sets unreadCount to 1)
 */
const markAsUnread = async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findByIdAndUpdate(
      id,
      { unreadCount: 1 },
      { returnDocument: 'after' }
    ).populate(['contactId', 'assignedTo']);

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'CONVERSATION_UNREAD',
      data: {
        conversationId: id,
        conversation
      }
    });

    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Upload WhatsApp Media File (Image, PDF, Document) to MyOperator Media Vault (Zero GCS cost)
 * with Cloud Storage fallback
 */
const uploadMedia = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No media file provided' });
    }

    const fileName = req.file.originalname || 'file';
    const fnLower = fileName.toLowerCase();
    
    // Resolve exact MIME type
    let resolvedMime = req.file.mimetype;
    if (!resolvedMime || resolvedMime === 'application/octet-stream') {
      if (fnLower.endsWith('.png')) resolvedMime = 'image/png';
      else if (fnLower.endsWith('.jpg') || fnLower.endsWith('.jpeg')) resolvedMime = 'image/jpeg';
      else if (fnLower.endsWith('.webp')) resolvedMime = 'image/webp';
      else if (fnLower.endsWith('.gif')) resolvedMime = 'image/gif';
      else if (fnLower.endsWith('.pdf')) resolvedMime = 'application/pdf';
      else if (fnLower.endsWith('.csv')) resolvedMime = 'text/csv';
      else if (fnLower.endsWith('.xlsx')) resolvedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (fnLower.endsWith('.xls')) resolvedMime = 'application/vnd.ms-excel';
      else if (fnLower.endsWith('.docx')) resolvedMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (fnLower.endsWith('.doc')) resolvedMime = 'application/msword';
      else if (fnLower.endsWith('.txt')) resolvedMime = 'text/plain';
      else if (fnLower.endsWith('.zip')) resolvedMime = 'application/zip';
      else if (fnLower.endsWith('.mp3')) resolvedMime = 'audio/mpeg';
      else if (fnLower.endsWith('.mp4')) resolvedMime = 'video/mp4';
      else resolvedMime = 'application/octet-stream';
    }

    // 1. Always upload to GCS to guarantee a permanent, high-speed public CDN URL for the panel and WABA
    const { uploadToGCS } = require('../utils/gcs');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destination = `whatsapp-media/${Date.now()}-${safeName}`;

    const mediaUrl = await uploadToGCS(req.file.buffer, destination, resolvedMime);

    // 2. Optional MyOperator Media Vault registration (for document reference)
    let mediaId = undefined;
    try {
      const myopMedia = await myoperatorService.uploadMedia({
        fileBuffer: req.file.buffer,
        fileName: fileName,
        mimeType: resolvedMime
      });
      mediaId = myopMedia?.media_id || myopMedia?.id || myopMedia?.mediaId;
    } catch (_) {}

    res.json({
      success: true,
      data: {
        mediaUrl,
        mediaId: mediaId ? String(mediaId) : undefined,
        fileName,
        mimeType: resolvedMime,
        fileSize: req.file.size
      }
    });
  } catch (error) {
    console.error('[uploadMedia Error]:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to upload media file' });
  }
};

/**
 * Generate Presigned Signed URL for Zero-Memory Direct-to-GCS Media Upload
 */
const getMediaUploadUrl = async (req, res) => {
  try {
    const { fileName, mimeType } = req.body;
    if (!fileName || !mimeType) {
      return res.status(400).json({ success: false, message: 'fileName and mimeType are required' });
    }

    const { getSignedUploadUrl } = require('../utils/gcs');
    const safeName = (fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const destination = `whatsapp-media/${Date.now()}-${safeName}`;

    const result = await getSignedUploadUrl(destination, mimeType);

    res.json({
      success: true,
      data: {
        uploadUrl: result.uploadUrl,
        mediaUrl: result.publicUrl,
        destination,
        fileName,
        mimeType
      }
    });
  } catch (error) {
    console.error('[getMediaUploadUrl Error]:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to generate signed upload URL' });
  }
};

/**
 * Proxy media files (S3, MyOperator, etc.) with CORS headers for Flutter Web
 */
const proxyMedia = async (req, res) => {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl) {
      return res.status(400).send('Missing url parameter');
    }

    const targetUrl = decodeURIComponent(rawUrl);
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).send('Invalid protocol');
    }

    const axios = require('axios');
    const response = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      timeout: 15000,
      headers: {
        'User-Agent': 'KrishiKranti-MediaProxy/1.0'
      }
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=604800');

    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }

    response.data.pipe(res);
  } catch (err) {
    console.error('[MediaProxy Error]:', err.message);
    res.status(502).send('Error fetching media');
  }
};

module.exports = {
  getConversations,
  syncRoster,
  getMessages,
  sendConversationMessage,
  assignConversation,
  addNote,
  startConversation,
  updateConversationStatus,
  updateConversationLanguage,
  markAsRead,
  markAsUnread,
  uploadMedia,
  getMediaUploadUrl,
  proxyMedia,
  getTemplates,
  createTemplate,
  deleteTemplate,
  getCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse
};
