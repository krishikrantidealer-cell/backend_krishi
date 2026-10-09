const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Note = require('../models/Note');
const User = require('../models/User');
const wsService = require('./websocket.service');
const { normalizeIndianPhone, getPhoneQueryVariants } = require('../utils/phone');

/**
 * Normalizes phone number to standard 10-digit string
 */
const normalizePhone = (rawPhone) => {
  return normalizeIndianPhone(rawPhone);
};

/**
 * Synchronizes a Lead or Dealer User record to a unified Contact & Conversation
 * @param {Object|String} userOrId - User document or User ID
 * @param {Object} options - { broadcastWs: Boolean }
 */
const syncUserToContactAndConversation = async (userOrId, options = { broadcastWs: false }) => {
  try {
    let user = userOrId;
    if (typeof userOrId === 'string' || userOrId instanceof require('mongoose').Types.ObjectId) {
      user = await User.findById(userOrId);
    }
    if (!user || !user.phoneNumber) return null;

    const phone = normalizeIndianPhone(user.phoneNumber);
    const phoneVariants = getPhoneQueryVariants(user.phoneNumber);

    // 1. Find or Create Contact
    let contact = await Contact.findOne({
      $or: [
        { phone: { $in: phoneVariants } },
        { phone: phone }
      ]
    });

    const isDealer = user.kycStatus === 'verified' || user.isKycComplete === true || user.role === 'dealer';
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    const contactName = fullName || user.shopName || 'Krishi Customer';

    const tags = [
      isDealer ? 'Dealer' : 'Lead',
      isDealer ? 'Verified Retailer' : (user.status ? `Status: ${user.status}` : 'New Lead'),
      user.shopName ? `Shop: ${user.shopName}` : null,
      user.address?.cityTehsil ? `City: ${user.address.cityTehsil}` : null,
      user.address?.state ? `State: ${user.address.state}` : null,
    ].filter(Boolean);

    if (!contact) {
      contact = new Contact({
        name: contactName,
        phone: phone,
        assignedTo: user.assignedAgent || null,
        tags: tags,
        preferredLanguage: user.preferredLanguage || 'en'
      });
      await contact.save();
    } else {
      contact.name = contactName;
      contact.assignedTo = user.assignedAgent !== undefined ? (user.assignedAgent || null) : (contact.assignedTo || null);
      // Merge tags without duplicate duplicates
      const mergedTags = Array.from(new Set([...(contact.tags || []), ...tags]));
      contact.tags = mergedTags;
      if (user.preferredLanguage) {
        contact.preferredLanguage = user.preferredLanguage;
      }
      await contact.save();
    }

    const contactType = isDealer ? 'dealer' : 'lead';

    // 2. Find or Create Conversation
    let conversation = await Conversation.findOne({ contactId: contact._id });
    const isNewConversation = !conversation;

    if (!conversation) {
      conversation = new Conversation({
        contactId: contact._id,
        assignedTo: user.assignedAgent || null,
        contactType: contactType,
        contactName: contactName,
        contactPhone: phone,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: user.assignedAt || user.createdAt || new Date()
      });
      await conversation.save();
    } else {
      let needsSave = false;
      const targetAssigned = user.assignedAgent !== undefined ? (user.assignedAgent || null) : conversation.assignedTo;
      if (String(conversation.assignedTo || '') !== String(targetAssigned || '')) {
        conversation.assignedTo = targetAssigned;
        needsSave = true;
      }
      if (conversation.contactType !== contactType) {
        conversation.contactType = contactType;
        needsSave = true;
      }
      if (conversation.contactName !== contactName) {
        conversation.contactName = contactName;
        needsSave = true;
      }
      if (conversation.contactPhone !== phone) {
        conversation.contactPhone = phone;
        needsSave = true;
      }
      if (needsSave) {
        await conversation.save();
      }
    }

    // 3. Real-time WebSocket notification to assigned sales agent if requested
    if (options.broadcastWs && user.assignedAgent) {
      const populatedConv = await Conversation.findById(conversation._id)
        .populate('contactId')
        .populate('assignedTo', 'firstName lastName email phoneNumber');

      wsService.sendToUser(String(user.assignedAgent), {
        type: isNewConversation ? 'CONVERSATION_ASSIGNED' : 'CONVERSATION_UPDATED',
        data: populatedConv
      });

      // Also notify Admins
      wsService.broadcastToRoles(['admin'], {
        type: 'CONVERSATION_UPDATED',
        data: populatedConv
      });
    }

    return { contact, conversation };
  } catch (error) {
    console.error('[ContactSync] Error syncing user to contact/conversation:', error.message);
    return null;
  }
};

// Global Distributed Sync Cooldown Cache via Redis (Prevents DB saturation on rapid tab switching & multi-instance collisions)
const { redisClient } = require('../config/redis');
let lastGlobalSyncTimestamp = 0;
const agentSyncTimestamps = new Map();
const SYNC_COOLDOWN_SECONDS = 600; // 10 minutes
const SYNC_COOLDOWN_MS = SYNC_COOLDOWN_SECONDS * 1000;

const acquireSyncLock = async (lockKey, ttlSeconds = SYNC_COOLDOWN_SECONDS, force = false) => {
  if (force) return true;
  try {
    if (redisClient && redisClient.isOpen) {
      const res = await redisClient.set(lockKey, '1', { EX: ttlSeconds, NX: true });
      return res !== null; // true if lock acquired, false if already in cooldown
    }
  } catch (err) {
    console.warn('[Redis Sync Lock Warning]:', err.message);
  }
  return true;
};

/**
 * Bulk sync all assigned leads and dealers for a specific sales agent in concurrent batches
 * @param {String} agentId
 * @param {Boolean} force
 */
const syncAllAssignedUsersForAgent = async (agentId, force = false) => {
  try {
    if (!agentId) return { synced: 0 };

    const lockKey = `crm:sync:agent:${agentId}`;
    const acquired = await acquireSyncLock(lockKey, SYNC_COOLDOWN_SECONDS, force);
    if (!acquired) {
      return { synced: 0, cached: true };
    }

    const now = Date.now();
    const lastSync = agentSyncTimestamps.get(String(agentId)) || 0;
    if (!force && now - lastSync < SYNC_COOLDOWN_MS) {
      return { synced: 0, cached: true };
    }
    agentSyncTimestamps.set(String(agentId), now);

    const users = await User.find({
      assignedAgent: agentId,
      role: { $in: ['user', 'dealer'] }
    }).lean();

    let count = 0;
    const BATCH_SIZE = 50;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const chunk = users.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        chunk.map(u => syncUserToContactAndConversation(u, { broadcastWs: false }))
      );
      count += results.filter(Boolean).length;
    }

    return { synced: count, total: users.length };
  } catch (error) {
    console.error(`[ContactSync] Error syncing for agent ${agentId}:`, error.message);
    return { synced: 0, error: error.message };
  }
};

/**
 * Bulk sync all users with assigned agents in the database
 */
const syncAllAssignedUsers = async (force = false) => {
  try {
    const users = await User.find({
      assignedAgent: { $ne: null, $exists: true },
      role: { $in: ['user', 'dealer'] }
    }).lean();

    let count = 0;
    const BATCH_SIZE = 50;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const chunk = users.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        chunk.map(u => syncUserToContactAndConversation(u, { broadcastWs: false }))
      );
      count += results.filter(Boolean).length;
    }

    console.log(`[ContactSync] Successfully synced ${count} assigned users to contacts/conversations.`);
    return { synced: count, total: users.length };
  } catch (error) {
    console.error('[ContactSync] Error in bulk sync:', error.message);
    return { synced: 0, error: error.message };
  }
};

/**
 * Bulk sync ALL Leads and Dealers in the system (Assigned and Unassigned) for Admins
 * @param {Boolean} force
 */
const syncAllUsers = async (force = false) => {
  try {
    const lockKey = 'crm:sync:global';
    const acquired = await acquireSyncLock(lockKey, SYNC_COOLDOWN_SECONDS, force);
    if (!acquired) {
      return { synced: 0, cached: true };
    }

    const now = Date.now();
    if (!force && now - lastGlobalSyncTimestamp < SYNC_COOLDOWN_MS) {
      return { synced: 0, cached: true };
    }
    lastGlobalSyncTimestamp = now;

    const users = await User.find({
      role: { $in: ['user', 'dealer'] },
      phoneNumber: { $exists: true, $ne: '' }
    }).lean();

    let count = 0;
    const BATCH_SIZE = 50;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const chunk = users.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        chunk.map(u => syncUserToContactAndConversation(u, { broadcastWs: false }))
      );
      count += results.filter(Boolean).length;
    }

    console.log(`[ContactSync] Successfully synced ${count} total leads & dealers to contacts/conversations.`);
    return { synced: count, total: users.length };
  } catch (error) {
    console.error('[ContactSync] Error in bulk sync all users:', error.message);
    return { synced: 0, error: error.message };
  }
};

/**
 * Automatically merges duplicate Contacts & Conversations for identical 10-digit phone numbers
 */
let isDeduplicating = false;
const deduplicateContactsAndConversations = async () => {
  if (isDeduplicating) return;
  isDeduplicating = true;
  try {
    // 1. Fix 8-digit and 12-digit phone numbers directly in database
    const malformedContacts = await Contact.find({
      $or: [
        { phone: { $regex: /^[6-9]\d{7}$/ } },
        { phone: { $regex: /^91\d{10}$/ } }
      ]
    }).select('_id phone').lean();

    for (const c of malformedContacts) {
      const clean10 = normalizeIndianPhone(c.phone);
      if (clean10 && clean10 !== c.phone) {
        const existing = await Contact.findOne({ phone: clean10 });
        if (existing && String(existing._id) !== String(c._id)) {
          await Message.updateMany({ contactId: c._id }, { contactId: existing._id });
          await Conversation.deleteMany({ contactId: c._id });
          await Contact.findByIdAndDelete(c._id);
        } else {
          await Contact.findByIdAndUpdate(c._id, { phone: clean10 }).catch(() => {});
        }
      }
    }

    // 2. Find duplicate Contacts by phone using fast aggregation
    const dupPhoneGroups = await Contact.aggregate([
      { $match: { phone: { $exists: true, $ne: '' } } },
      { $group: { _id: "$phone", count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } }
    ]);

    for (const group of dupPhoneGroups) {
      const list = await Contact.find({ _id: { $in: group.ids } });
      if (list.length <= 1) continue;

      // Sort: prefer verified dealer, real human name, assigned agent
      list.sort((a, b) => {
        const aDealer = (a.tags || []).some(t => /dealer|retailer/i.test(t));
        const bDealer = (b.tags || []).some(t => /dealer|retailer/i.test(t));
        if (aDealer && !bDealer) return -1;
        if (!aDealer && bDealer) return 1;

        const aHuman = a.name && !a.name.startsWith('User ') && !/^\d+$/.test(a.name);
        const bHuman = b.name && !b.name.startsWith('User ') && !/^\d+$/.test(b.name);
        if (aHuman && !bHuman) return -1;
        if (!aHuman && bHuman) return 1;

        if (a.assignedTo && !b.assignedTo) return -1;
        if (!a.assignedTo && b.assignedTo) return 1;
        return 0;
      });

      const primary = list[0];
      const duplicates = list.slice(1);
      const dupContactIds = duplicates.map(d => d._id);

      // Merge tags
      const allTags = new Set(primary.tags || []);
      duplicates.forEach(d => (d.tags || []).forEach(t => allTags.add(t)));
      primary.tags = Array.from(allTags);
      primary.phone = group._id;
      await primary.save();

      // Re-link messages and notes to primary contact
      await Message.updateMany(
        { contactId: { $in: dupContactIds } },
        { contactId: primary._id }
      );
      await Contact.deleteMany({ _id: { $in: dupContactIds } });
    }

    // 3. Find duplicate Conversations by contactId or canonical phone
    const dupConvGroups = await Conversation.aggregate([
      { $group: { _id: "$contactId", count: { $sum: 1 }, convIds: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 }, _id: { $ne: null } } }
    ]);

    for (const group of dupConvGroups) {
      const convList = await Conversation.find({ _id: { $in: group.convIds } });
      if (convList.length <= 1) continue;

      convList.sort((a, b) => {
        const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bTime - aTime;
      });

      const primaryConv = convList[0];
      const dupConvs = convList.slice(1);
      const dupConvIds = dupConvs.map(c => c._id);

      await Message.updateMany(
        { conversationId: { $in: dupConvIds } },
        { conversationId: primaryConv._id, contactId: primaryConv.contactId }
      );
      await Note.updateMany(
        { conversationId: { $in: dupConvIds } },
        { conversationId: primaryConv._id }
      );

      for (const dc of dupConvs) {
        if (dc.lastIncomingMessageAt && (!primaryConv.lastIncomingMessageAt || new Date(dc.lastIncomingMessageAt) > new Date(primaryConv.lastIncomingMessageAt))) {
          primaryConv.lastIncomingMessageAt = dc.lastIncomingMessageAt;
        }
        if (dc.lastMessageAt && (!primaryConv.lastMessageAt || new Date(dc.lastMessageAt) > new Date(primaryConv.lastMessageAt))) {
          primaryConv.lastMessageAt = dc.lastMessageAt;
          if (dc.lastMessage) primaryConv.lastMessage = dc.lastMessage;
        }
        if (dc.unreadCount && dc.unreadCount > 0) {
          primaryConv.unreadCount = Math.max(primaryConv.unreadCount || 0, dc.unreadCount);
        }
      }

      // Ensure primaryConv.lastMessage matches the truly latest Message in database
      const latestMsg = await Message.findOne({ conversationId: primaryConv._id }).sort({ createdAt: -1, _id: -1 }).lean();
      if (latestMsg) {
        const lType = ['text', 'image', 'document', 'audio', 'video', 'template'].includes(latestMsg.type) ? latestMsg.type : 'text';
        const lContent = latestMsg.content || (latestMsg.mediaUrl ? `[${lType}]` : '');
        primaryConv.lastMessage = {
          type: lType,
          content: lContent,
          mediaUrl: latestMsg.mediaUrl
        };
        primaryConv.lastMessageAt = latestMsg.createdAt;
      }

      await primaryConv.save();
      await Conversation.deleteMany({ _id: { $in: dupConvIds } });
    }

    // 4. Automatic Message Deduplication (cleans any duplicate bubbles within 30s window)
    const recentMsgs = await Message.find({}).sort({ createdAt: -1 }).limit(300);
    const deletedMsgIds = new Set();
    for (let i = 0; i < recentMsgs.length; i++) {
      if (deletedMsgIds.has(String(recentMsgs[i]._id))) continue;
      const m1 = recentMsgs[i];
      for (let j = i + 1; j < recentMsgs.length; j++) {
        if (deletedMsgIds.has(String(recentMsgs[j]._id))) continue;
        const m2 = recentMsgs[j];
        const sameConv = String(m1.conversationId) === String(m2.conversationId);
        const sameDir = m1.direction === m2.direction;
        const sameContent = (m1.content || '').trim() === (m2.content || '').trim();
        const timeDiff = Math.abs(new Date(m1.createdAt).getTime() - new Date(m2.createdAt).getTime());
        if (sameConv && sameDir && sameContent && timeDiff <= 30000) {
          const rawIds = [m1.myoperatorMessageId, m2.myoperatorMessageId, m1.wabaMessageId, m2.wabaMessageId].filter(Boolean);
          const myopUuid = rawIds.find(id => typeof id === 'string' && id.length <= 40 && !id.startsWith('wamid.'));
          const wabaId = rawIds.find(id => typeof id === 'string' && id.startsWith('wamid.'));
          const newStatus = m2.status === 'read' ? 'read' : (m1.status === 'read' ? 'read' : (m2.status || m1.status));
          await Message.findByIdAndDelete(m2._id);
          deletedMsgIds.add(String(m2._id));
          await Message.findByIdAndUpdate(m1._id, {
            sentBy: newSentBy,
            myoperatorMessageId: myopUuid || wabaId,
            wabaMessageId: wabaId,
            status: newStatus
          });
        }
      }
    }
  } catch (err) {
    console.error('[ContactSync] Fast deduplication error:', err.message);
  } finally {
    isDeduplicating = false;
  }
};

/**
 * Backfills missing contactType on legacy Conversation records using bounded batches
 */
const ensureContactTypesBackfilled = async () => {
  try {
    const unpopulated = await Conversation.find({
      $or: [
        { contactType: { $exists: false } },
        { contactType: null }
      ]
    }).limit(200).populate('contactId').lean();

    if (!unpopulated || unpopulated.length === 0) return;

    for (const conv of unpopulated) {
      const contact = conv.contactId;
      if (!contact) continue;
      const isDealer = (contact.tags || []).some(t => /dealer|retailer/i.test(t));
      const cleanPhone = normalizeIndianPhone(contact.phone);
      await Conversation.findByIdAndUpdate(conv._id, {
        contactType: isDealer ? 'dealer' : 'lead',
        contactName: contact.name || `User ${cleanPhone.slice(-4)}`,
        contactPhone: cleanPhone
      });
    }
  } catch (err) {
    console.error('[ContactSync] ensureContactTypesBackfilled error:', err.message);
  }
};

module.exports = {
  syncUserToContactAndConversation,
  syncAllAssignedUsersForAgent,
  syncAllAssignedUsers,
  syncAllUsers,
  ensureContactTypesBackfilled,
  deduplicateContactsAndConversations
};
