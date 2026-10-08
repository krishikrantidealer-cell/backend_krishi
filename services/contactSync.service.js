const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const wsService = require('./websocket.service');

/**
 * Normalizes phone number to standard 10-digit / 12-digit string
 */
const normalizePhone = (rawPhone) => {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
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

    const phone = normalizePhone(user.phoneNumber);
    const tenDigit = phone.replace(/^91/, '');

    // 1. Find or Create Contact
    let contact = await Contact.findOne({
      phone: { $in: [phone, tenDigit, `91${tenDigit}`] }
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
      contact.assignedTo = user.assignedAgent || contact.assignedTo || null;
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
      if (user.assignedAgent && String(conversation.assignedTo) !== String(user.assignedAgent)) {
        conversation.assignedTo = user.assignedAgent;
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

// Global Sync Cooldown Cache (Prevents DB saturation on rapid tab switching)
let lastGlobalSyncTimestamp = 0;
const agentSyncTimestamps = new Map();
const SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Bulk sync all assigned leads and dealers for a specific sales agent in concurrent batches
 * @param {String} agentId
 * @param {Boolean} force
 */
const syncAllAssignedUsersForAgent = async (agentId, force = false) => {
  try {
    if (!agentId) return { synced: 0 };

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
 * Instant DB backfill to ensure 100% of Conversation records have contactType populated
 */
const ensureContactTypesBackfilled = async () => {
  try {
    const dealerContacts = await Contact.find({
      tags: { $in: ['Dealer', 'Verified Retailer', /^Dealer/i] }
    }).select('_id').lean();

    if (dealerContacts.length > 0) {
      const dealerIds = dealerContacts.map(c => c._id);
      await Conversation.updateMany(
        { contactId: { $in: dealerIds }, contactType: { $ne: 'dealer' } },
        { $set: { contactType: 'dealer' } }
      );
    }

    await Conversation.updateMany(
      { $or: [{ contactType: { $exists: false } }, { contactType: null }] },
      { $set: { contactType: 'lead' } }
    );
    console.log('[ContactSync] ContactType backfill check completed successfully.');
  } catch (err) {
    console.error('[ContactSync] Backfill warning:', err.message);
  }
};

module.exports = {
  syncUserToContactAndConversation,
  syncAllAssignedUsersForAgent,
  syncAllAssignedUsers,
  syncAllUsers,
  ensureContactTypesBackfilled
};
