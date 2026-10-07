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

    // 2. Find or Create Conversation
    let conversation = await Conversation.findOne({ contactId: contact._id });
    const isNewConversation = !conversation;

    if (!conversation) {
      conversation = new Conversation({
        contactId: contact._id,
        assignedTo: user.assignedAgent || null,
        status: 'open',
        unreadCount: 0,
        lastMessageAt: user.assignedAt || user.createdAt || new Date()
      });
      await conversation.save();
    } else {
      if (user.assignedAgent && String(conversation.assignedTo) !== String(user.assignedAgent)) {
        conversation.assignedTo = user.assignedAgent;
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

/**
 * Bulk sync all assigned leads and dealers for a specific sales agent
 * @param {String} agentId
 */
const syncAllAssignedUsersForAgent = async (agentId) => {
  try {
    if (!agentId) return { synced: 0 };
    const users = await User.find({
      assignedAgent: agentId,
      role: { $in: ['user', 'dealer'] }
    });

    let count = 0;
    for (const user of users) {
      const res = await syncUserToContactAndConversation(user, { broadcastWs: false });
      if (res) count++;
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
const syncAllAssignedUsers = async () => {
  try {
    const users = await User.find({
      assignedAgent: { $ne: null, $exists: true },
      role: { $in: ['user', 'dealer'] }
    });

    let count = 0;
    for (const user of users) {
      const res = await syncUserToContactAndConversation(user, { broadcastWs: false });
      if (res) count++;
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
 */
const syncAllUsers = async () => {
  try {
    const users = await User.find({
      role: { $in: ['user', 'dealer'] },
      phoneNumber: { $exists: true, $ne: '' }
    });

    let count = 0;
    for (const user of users) {
      const res = await syncUserToContactAndConversation(user, { broadcastWs: false });
      if (res) count++;
    }

    console.log(`[ContactSync] Successfully synced ${count} total leads & dealers to contacts/conversations.`);
    return { synced: count, total: users.length };
  } catch (error) {
    console.error('[ContactSync] Error in bulk sync all users:', error.message);
    return { synced: 0, error: error.message };
  }
};

module.exports = {
  syncUserToContactAndConversation,
  syncAllAssignedUsersForAgent,
  syncAllAssignedUsers,
  syncAllUsers
};
