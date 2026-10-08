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

// Run fast one-time DB backfill check asynchronously on startup
contactSyncService.ensureContactTypesBackfilled().catch(err => {
  console.error('[ConversationController] Startup backfill error:', err.message);
});

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

    // Role-based security filters: sales agents see only their assigned contacts/conversations
    if (req.user.role === 'sales') {
      const assignedContactIds = await Contact.find({ assignedTo: req.user.id }).distinct('_id');
      conditions.push({
        $or: [
          { assignedTo: req.user.id },
          ...(assignedContactIds.length > 0 ? [{ contactId: { $in: assignedContactIds } }] : [])
        ]
      });
    } else if (req.user.role === 'admin' && agentId) {
      // Admin filtering by specific sales agent
      const assignedContactIds = await Contact.find({ assignedTo: agentId }).distinct('_id');
      conditions.push({
        $or: [
          { assignedTo: agentId },
          ...(assignedContactIds.length > 0 ? [{ contactId: { $in: assignedContactIds } }] : [])
        ]
      });
    }

    // Tab-based filtering: 'all', 'active', 'leads', 'dealers', 'unread'
    if (tab === 'active') {
      conditions.push({ 'lastMessage.content': { $exists: true, $ne: '' } });
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
      const cleanPhone = cleanSearch.replace(/\D/g, '').replace(/^91/, '');
      const matchingContacts = await Contact.find({
        $or: [
          { name: { $regex: cleanSearch, $options: 'i' } },
          { tags: { $regex: cleanSearch, $options: 'i' } },
          ...(cleanPhone ? [
            { phone: { $regex: cleanPhone } },
            { phone: { $regex: `91${cleanPhone}` } }
          ] : [])
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
    if (req.user.role === 'sales') {
      const assignedContactIds = await Contact.find({ assignedTo: req.user.id }).distinct('_id');
      baseConditions.push({
        $or: [
          { assignedTo: req.user.id },
          ...(assignedContactIds.length > 0 ? [{ contactId: { $in: assignedContactIds } }] : [])
        ]
      });
    } else if (req.user.role === 'admin' && agentId) {
      const assignedContactIds = await Contact.find({ assignedTo: agentId }).distinct('_id');
      baseConditions.push({
        $or: [
          { assignedTo: agentId },
          ...(assignedContactIds.length > 0 ? [{ contactId: { $in: assignedContactIds } }] : [])
        ]
      });
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
              { $match: { 'lastMessage.content': { $exists: true, $ne: '' } } },
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

    res.json({
      success: true,
      data: conversations,
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

    // Also pull latest WhatsApp messages from MyOperator
    try {
      await myoperatorService.syncAllMessagesFromMyOperator();
    } catch (_) {}

    res.json({
      success: true,
      message: `Roster sync completed: ${result.synced || 0} contacts synchronized`,
      data: result
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    // Clean unread count on reading conversation
    await Conversation.findByIdAndUpdate(id, { unreadCount: 0 });

    const messages = await Message.find({ conversationId: id })
      .populate('sentBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: messages.reverse(), // Send in chronological order
      page: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send message via API (Text or Media)
const sendConversationMessage = async (req, res) => {
  try {
    const { conversationId, type, content, mediaUrl, templateName, bodyValues, languageCode } = req.body;

    const conversation = await Conversation.findById(conversationId).populate('contactId');
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    // Role Security: Sales agents can ONLY send messages to leads/dealers assigned to them or unassigned
    if (req.user.role === 'sales') {
      const isAssignedConv = conversation.assignedTo && String(conversation.assignedTo) === String(req.user.id);
      const isAssignedContact = conversation.contactId?.assignedTo && String(conversation.contactId.assignedTo) === String(req.user.id);
      const isUnassigned = !conversation.assignedTo && !conversation.contactId?.assignedTo;

      if (!isAssignedConv && !isAssignedContact && !isUnassigned) {
        return res.status(403).json({ success: false, message: 'Access Denied: You can only chat with leads assigned to you.' });
      }

      // Auto-assign conversation to this sales agent if it was unassigned or only assigned on contact
      if (!isAssignedConv) {
        conversation.assignedTo = req.user.id;
        await conversation.save();
      }
    }

    const selectedLang = languageCode || conversation.contactId?.preferredLanguage || 'en';

    // Dispatches message to MyOperator WABA API with dedicated agent credentials
    const myopResponse = await myoperatorService.sendMessage({
      agentId: req.user.id,
      phone: conversation.contactId.phone,
      type,
      textBody: content,
      mediaUrl,
      templateName,
      bodyValues,
      languageCode: selectedLang
    });

    const messageId = myopResponse?.id || myopResponse?.data?.id || myopResponse?.message?.id || myopResponse?.message_id;

    // Resolve actual message text if sending a template
    let resolvedContent = content;
    if ((type && type.toLowerCase() === 'template') || templateName) {
      if (!resolvedContent || resolvedContent.startsWith('[Template]')) {
        try {
          const tpl = await WhatsAppTemplate.findOne({
            name: templateName,
            $or: [
              { isGlobal: true },
              { agentId: req.user.id }
            ]
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

    const messageData = {
      conversationId: conversation._id,
      contactId: conversation.contactId._id,
      direction: 'outgoing',
      type: type.toLowerCase(),
      content: resolvedContent || `[Template] ${templateName}`,
      mediaUrl,
      sentBy: req.user.id,
      status: 'sent'
    };

    if (messageId) {
      messageData.myoperatorMessageId = messageId.toString();
    }

    const message = new Message(messageData);
    await message.save();

    // Update conversation metadata
    conversation.lastMessage = { type: type.toLowerCase(), content: resolvedContent, mediaUrl };
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // Broadcast new message update via Native WebSockets
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

    res.json({ success: true, data: message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    // Clean phone number to digits only (10 digits, no leading 91 or +91)
    const cleanPhone = phone.replace(/[^\d]/g, '').replace(/^91/, '');

    // Check if there is an existing User (Lead/Dealer) with this phone number
    const existingUser = await User.findOne({
      $or: [
        { phoneNumber: cleanPhone },
        { phoneNumber: `91${cleanPhone}` },
        { phoneNumber: `+91${cleanPhone}` },
        { phoneNumber: phone }
      ]
    }).populate('assignedAgent');

    // 1. Create or Find Contact
    let contact = await Contact.findOne({
      $or: [
        { phone: phone },
        { phone: cleanPhone },
        { phone: `91${cleanPhone}` },
        { phone: `+91${cleanPhone}` }
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
    }
else {
      // Sync: If the Contact exists but its assignment is different from the User's assignment, update it!
      if (existingUser && assignedAgentId && String(contact.assignedTo) !== String(assignedAgentId)) {
        contact.assignedTo = assignedAgentId;
        await contact.save();
      }
    }

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
        assignedTo: contact.assignedTo || req.user.id
      });
      await conversation.save();
    } else {
      // Sync Conversation's assignment to match Contact's assignment
      if (String(conversation.assignedTo) !== String(contact.assignedTo)) {
        conversation.assignedTo = contact.assignedTo;
        await conversation.save();
      }
    }

    const populated = await Conversation.findById(conversation._id)
      .populate('contactId')
      .populate('assignedTo', 'firstName lastName email');

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
  getTemplates,
  createTemplate,
  deleteTemplate,
  getCannedResponses,
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse
};
