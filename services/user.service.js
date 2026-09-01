const User = require('../models/User');
const notificationService = require('./notification.service');

class UserService {
  async getAllUsers(filters = {}) {
    // Optionally filter by role, kycStatus, etc.
    const query = {};
    if (filters.trash === 'true' || filters.trash === true) {
      query.isDeleted = true;
    } else {
      query.isDeleted = { $ne: true };
    }

    // Support Date Range Filtering
    if (filters.startDate || filters.endDate) {
      const dateField = (filters.trash === 'true' || filters.trash === true) ? 'deletedAt' : 'createdAt';
      query[dateField] = {};
      if (filters.startDate) {
        query[dateField].$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query[dateField].$lte = end;
      }
    }

    if (filters.role) query.role = filters.role;
    
    if (filters.kycStatus) {
      if (filters.kycStatus === 'not_verified') {
        query.kycStatus = { $ne: 'verified' };
      } else {
        query.kycStatus = filters.kycStatus;
      }
    }
    if (filters.assignedAgent) query.assignedAgent = filters.assignedAgent;

    // Support database keyword search
    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      query.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phoneNumber: searchRegex }
      ];
    }
    
    const page = parseInt(filters.page) || 1;
    const limit = parseInt(filters.limit) || 0; // 0 means no limit
    const skip = (page - 1) * limit;

    const totalCount = await User.countDocuments(query);

    const baseQuery = User.find(query)
      .populate('assignedAgent', 'firstName lastName phoneNumber email')
      .select('-password')
      .sort(filters.trash === 'true' || filters.trash === true ? { deletedAt: -1 } : { createdAt: -1 });

    if (limit > 0) {
      baseQuery.skip(skip).limit(limit);
    }

    const users = await baseQuery;
    const hasMore = limit > 0 ? (skip + users.length < totalCount) : false;

    return { users, totalCount, hasMore };
  }

  async getProfile(userId, includeDeleted = false) {
    let user;
    const mongoose = require('mongoose');

    if (mongoose.Types.ObjectId.isValid(userId)) {
      user = await User.findById(userId);
    } else {
      // Fallback: search by phone or email if not a valid ObjectId
      user = await User.findOne({
        $or: [
          { phoneNumber: userId },
          { email: userId }
        ]
      });
    }

    if (!user || (user.isDeleted && !includeDeleted)) {
      throw new Error('User not found');
    }
    return user;
  }

  async updateProfile(userId, updateData) {
    // Only allow specific fields to be updated
    const allowedUpdates = [
      'permissions',
      'firstName',
      'lastName',
      'profileImage',
      'addressType',
      'address',
      'shopName',
      'gstNumber',
      'farmSize',
      'cropTypes',
      'preferredLanguage',
      'status',
      'notes',
      'leadStatus',
      'leadNotes',
      'monthlyTarget',
      'notesHistory',
      'noteType',
      'notePriority'
    ];
    const filteredUpdates = {};

    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        if (key === 'leadStatus') {
          filteredUpdates['status'] = updateData[key];
        } else if (key === 'leadNotes') {
          filteredUpdates['notes'] = updateData[key];
        } else {
          filteredUpdates[key] = updateData[key];
        }
      }
    });

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Handle Notes History
    if (filteredUpdates.notes && filteredUpdates.notes !== user.notes) {
      const historyItem = {
        note: filteredUpdates.notes,
        createdAt: new Date(),
        type: updateData.noteType || 'general',
        priority: updateData.notePriority || 'medium',
        status: user.status || ''
      };
      if (updateData.adminId) historyItem.adminId = updateData.adminId;
      if (updateData.adminName) historyItem.adminName = updateData.adminName;

      user.notesHistory = user.notesHistory || [];
      user.notesHistory.push(historyItem);
    }

    // Apply updates
    Object.assign(user, filteredUpdates);
    await user.save();

    return await User.findById(userId).populate('assignedAgent', 'firstName lastName phoneNumber email');
  }

  async completeProfile(userId, profileData) {
    const { firstName, lastName, addressType, address, source, deepLinkUrl, permissions } = profileData;

    if (!firstName || !lastName || !addressType || !address) {
      throw new Error('All profile fields are required');
    }

    const updateFields = {
      firstName,
      lastName,
      addressType,
      address,
      source: source || 'App',
      deepLinkUrl: deepLinkUrl || null,
      isProfileComplete: true,
      isVerified: true
    };

    if (permissions) {
      updateFields.permissions = permissions;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }
  async submitKyc(userId, kycData, keepVerified = false) {
    const { userType, shopName, gstNumber, licenceImage, shopImage } = kycData;

    if (!userType) {
      throw new Error('User type is required');
    }

    if (!shopName) {
      throw new Error('Shop name is required');
    }

    if (!licenceImage || typeof licenceImage !== 'string' || licenceImage.trim() === '') {
      throw new Error('Licence image is required');
    }

    if (!shopImage || typeof shopImage !== 'string' || shopImage.trim() === '') {
      throw new Error('Shop image is required');
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          userType,
          shopName,
          gstNumber,
          licenceImage,
          shopImage,
          kycStatus: keepVerified ? 'verified' : 'processing',
          isKycComplete: keepVerified ? true : false
        }
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }
  async addShippingAddress(userId, addressData) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // If this is the first address, make it default
    if (user.shippingAddresses.length === 0) {
      addressData.isDefault = true;
    } else if (addressData.isDefault) {
      // If setting a new default, unset others
      user.shippingAddresses.forEach(addr => addr.isDefault = false);
    }

    user.shippingAddresses.push(addressData);
    await user.save();
    return user;
  }

  async deleteShippingAddress(userId, addressId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const addressIndex = user.shippingAddresses.findIndex(addr => addr._id.toString() === addressId);
    if (addressIndex === -1) throw new Error('Address not found');

    const wasDefault = user.shippingAddresses[addressIndex].isDefault;
    user.shippingAddresses.splice(addressIndex, 1);

    // If we deleted the default address, make the first remaining one default
    if (wasDefault && user.shippingAddresses.length > 0) {
      user.shippingAddresses[0].isDefault = true;
    }

    await user.save();
    return user;
  }

  async setDefaultAddress(userId, addressId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.shippingAddresses.forEach(addr => {
      addr.isDefault = addr._id.toString() === addressId;
    });

    await user.save();
    return user;
  }

  async updateFcmToken(userId, fcmToken) {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { fcmToken } },
      { new: true }
    );
    if (!user) throw new Error('User not found');
    return user;
  }

  async updateKycStatus(userId, status, reason = '') {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error('Invalid User ID');
    }

    const isVerified = status === 'verified';

    const updateData = {
      kycStatus: status,
      isKycComplete: isVerified,
      isVerified: isVerified,
      status: isVerified ? 'verified' : (status === 'rejected' ? 'rejected' : status)
    };

    if (isVerified) {
      updateData.kycApprovedAt = new Date();
      updateData.isProfileComplete = true;
    }

    if (status === 'rejected') {
      updateData.kycRejectedAt = new Date();
      updateData.kycReason = reason;
      updateData.reason = reason;
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: false } // Bypasses strict full-document validation for speed and robustness
    );

    if (!user) throw new Error('User not found');

    // Trigger Notification safely (Non-blocking background task)
    try {
      let title = "KYC Update 📄";
      let body = "";

      if (status === 'verified') {
        body = "Congratulations! Your KYC has been verified. You can now place orders.";
      } else if (status === 'rejected') {
        body = `KYC Rejected. ${reason || "Please check your documents and re-upload."}`;
      } else {
        body = `Your KYC status has been updated to: ${status}`;
      }

      notificationService.sendUtilityNotification(
        userId,
        title,
        body,
        '/profile'
      ).catch(err => console.error("[Notification] Service error:", err.message));
    } catch (notifyErr) {
      console.error("[Notification] Setup error:", notifyErr.message);
    }

    return user;
  }

  async assignAgent(userId, agentId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if (agentId) {
      const agent = await User.findById(agentId);
      if (!agent) throw new Error('Agent not found');
      if (agent.role !== 'sales') {
        throw new Error('Assigned user must be a sales agent');
      }
      user.assignedAgent = agentId;
      user.assignedAt = new Date();

      // When assigned to a sales agent, a 'prospect' lead becomes 'new'
      if (user.status === 'prospect') {
        user.status = 'new';
      }
    } else {
      user.assignedAgent = null;
      user.assignedAt = null;
    }

    await user.save();
    return await User.findById(userId).populate('assignedAgent', 'firstName lastName phoneNumber email');
  }

  async createSalesAgent(agentData) {
    const { firstName, lastName, email, phoneNumber, password, monthlyTarget, permissions } = agentData;

    if (!firstName || !lastName || !email || !phoneNumber || !password) {
      throw new Error('All fields (first name, last name, email, phone number, password) are required');
    }

    // Check if user already exists with email or phone number
    const existingEmail = await User.findOne({ email });
    if (existingEmail) throw new Error('Email already registered');

    const existingPhone = await User.findOne({ phoneNumber });
    if (existingPhone) throw new Error('Phone number already registered');

    const { hashData } = require('../utils/hash');
    const hashedPassword = await hashData(password);

    const user = await User.create({
      firstName,
      lastName,
      email,
      phoneNumber,
      password: hashedPassword,
      monthlyTarget: monthlyTarget || 500000,
      role: 'sales',
      isVerified: true,
      isProfileComplete: true
    });

    return user;
  }

  async updateSalesAgent(agentId, updateData) {
    const { firstName, lastName, email, phoneNumber, password, monthlyTarget, permissions } = updateData;

    const user = await User.findById(agentId);
    if (!user) throw new Error('Sales agent not found');
    if (user.role !== 'sales') throw new Error('User is not a sales agent');

    // Check email unique if changed
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) throw new Error('Email already registered');
      user.email = email;
    }

    // Check phone unique if changed
    if (phoneNumber && phoneNumber !== user.phoneNumber) {
      const existingPhone = await User.findOne({ phoneNumber });
      if (existingPhone) throw new Error('Phone number already registered');
      user.phoneNumber = phoneNumber;
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (monthlyTarget !== undefined) user.monthlyTarget = monthlyTarget;
    if (permissions !== undefined) user.permissions = permissions;

    if (password && password.trim() !== '') {
      const { hashData } = require('../utils/hash');
      user.password = await hashData(password);
    }

    await user.save();
    return user;
  }

  async deleteSalesAgent(agentId) {
    const user = await User.findById(agentId);
    if (!user) throw new Error('Sales agent not found');
    if (user.role !== 'sales') throw new Error('User is not a sales agent');

    // Unassign this agent from any leads or dealers they are assigned to
    await User.updateMany({ assignedAgent: agentId }, { $set: { assignedAgent: null } });

    await User.findByIdAndDelete(agentId);

    // Invalidate sessions
    try {
      const tokenService = require('./token.service');
      await tokenService.deleteAllSessions(agentId);
    } catch (sessionErr) {
      console.error('[Session Invalidation Error] Failed to delete sales agent sessions:', sessionErr.message);
    }

    return true;
  }

  async deleteUser(userId, adminId = null, adminName = null) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // We only allow deleting users with role 'user' through this method
    // Sales agents have their own delete method
    if (user.role !== 'user') throw new Error('Cannot delete this type of user here');
    if (user.isDeleted) throw new Error('User is already deleted');

    // Soft delete: suffix phoneNumber and email with _deleted_<timestamp>
    const suffix = `_deleted_${Date.now()}`;
    if (user.phoneNumber) {
      user.phoneNumber = user.phoneNumber + suffix;
    }
    if (user.email) {
      user.email = user.email + suffix;
    }

    user.isDeleted = true;
    user.deletedAt = new Date();

    if (adminId) user.deletedByAdminId = adminId;
    if (adminName) user.deletedByAdminName = adminName;

    await user.save();

    // Invalidate sessions
    try {
      const tokenService = require('./token.service');
      await tokenService.deleteAllSessions(userId);
    } catch (sessionErr) {
      console.error('[Session Invalidation Error] Failed to delete user sessions:', sessionErr.message);
    }

    return true;
  }

  async restoreUser(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    if (!user.isDeleted) throw new Error('User is not deleted');

    // Strip suffix: _deleted_<timestamp>
    let restoredPhone = user.phoneNumber;
    let restoredEmail = user.email;

    const deleteRegex = /_deleted_\d+$/;
    if (restoredPhone && deleteRegex.test(restoredPhone)) {
      restoredPhone = restoredPhone.replace(deleteRegex, '');
    }
    if (restoredEmail && deleteRegex.test(restoredEmail)) {
      restoredEmail = restoredEmail.replace(deleteRegex, '');
    }

    // Check unique constraints
    if (restoredPhone) {
      const existingPhone = await User.findOne({ phoneNumber: restoredPhone, isDeleted: { $ne: true } });
      if (existingPhone) {
        throw new Error('Cannot restore: Phone number is already in use by an active user');
      }
    }
    if (restoredEmail) {
      const existingEmail = await User.findOne({ email: restoredEmail, isDeleted: { $ne: true } });
      if (existingEmail) {
        throw new Error('Cannot restore: Email is already in use by an active user');
      }
    }

    user.phoneNumber = restoredPhone;
    user.email = restoredEmail;
    user.isDeleted = false;
    user.deletedAt = undefined;
    user.deletedByAdminId = undefined;
    user.deletedByAdminName = undefined;
    await user.save();
    return user;
  }

  async permanentlyDeleteUser(userId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if (user.role !== 'user') throw new Error('Cannot delete this type of user here');

    // Clean up related data
    const Cart = require('../models/Cart');
    const Favourite = require('../models/Favourite');
    const Notification = require('../models/Notification');

    await Promise.all([
      Cart.deleteMany({ user: userId }),
      Favourite.deleteMany({ user: userId }),
      Notification.deleteMany({ user: userId })
    ]);

    await User.findByIdAndDelete(userId);

    // Invalidate sessions
    try {
      const tokenService = require('./token.service');
      await tokenService.deleteAllSessions(userId);
    } catch (sessionErr) {
      console.error('[Session Invalidation Error] Failed to delete user sessions:', sessionErr.message);
    }

    return true;
  }

  async getDailyLeadStats({ dateStr, agentId = null }) {
    // Parse the date string the client sends as an IST (UTC+5:30) calendar date.
    // Cloud Run servers run in UTC, so we must compute the day boundaries manually
    // using the IST offset (+5h30m = +19800 seconds = +19800000 ms).
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in ms

    let targetDateStr = dateStr;
    if (!targetDateStr) {
      // Default to today in IST
      const nowIST = new Date(Date.now() + IST_OFFSET_MS);
      const y = nowIST.getUTCFullYear();
      const m = String(nowIST.getUTCMonth() + 1).padStart(2, '0');
      const d = String(nowIST.getUTCDate()).padStart(2, '0');
      targetDateStr = `${y}-${m}-${d}`;
    }

    // Parse YYYY-MM-DD and treat it as IST midnight
    const [year, month, day] = targetDateStr.split('-').map(Number);
    // IST midnight = UTC midnight minus 5h30m
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfDay   = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - IST_OFFSET_MS);

    // Get all active sales agents
    const salesAgents = await User.find({
      role: 'sales',
      isDeleted: { $ne: true }
    }).select('_id firstName lastName phoneNumber email');

    // Query leads that were newly assigned within the date window
    const assignedLeadsQuery = {
      isDeleted: { $ne: true },
      assignedAgent: agentId ? agentId : { $ne: null },
      assignedAt: { $gte: startOfDay, $lte: endOfDay }
    };
    const assignedLeadsOnDate = await User.find(assignedLeadsQuery)
      .select('_id assignedAgent firstName lastName phoneNumber status kycStatus createdAt assignedAt');

    // Query KYC verified dealers within the date window
    const kycApprovedQuery = {
      isDeleted: { $ne: true },
      kycStatus: 'verified',
      kycApprovedAt: { $gte: startOfDay, $lte: endOfDay }
    };
    if (agentId) kycApprovedQuery.assignedAgent = agentId;

    const kycApprovedOnDate = await User.find(kycApprovedQuery)
      .select('_id assignedAgent firstName lastName shopName status kycStatus createdAt kycApprovedAt');

    // Query deleted leads within the date window
    const deletedLeadsQuery = {
      isDeleted: true,
      deletedAt: { $gte: startOfDay, $lte: endOfDay }
    };
    if (agentId) deletedLeadsQuery.assignedAgent = agentId;

    const deletedLeadsOnDate = await User.find(deletedLeadsQuery)
      .select('_id assignedAgent firstName lastName phoneNumber createdAt deletedAt');

    const totalTeamAssigned = assignedLeadsOnDate.length;
    const totalTeamKycApproved = kycApprovedOnDate.length;
    const totalTeamDeleted = deletedLeadsOnDate.length;

    // Agent breakdown calculation - only include other agents for admins
    let agentBreakdown = [];
    if (!agentId) {
      agentBreakdown = salesAgents.map(agent => {
        const agentIdStr = String(agent._id);
        const assignedCount = assignedLeadsOnDate.filter(
          lead => lead.assignedAgent && String(lead.assignedAgent) === agentIdStr
        ).length;
        const kycApprovedCount = kycApprovedOnDate.filter(
          dealer => dealer.assignedAgent && String(dealer.assignedAgent) === agentIdStr
        ).length;
        const deletedCount = deletedLeadsOnDate.filter(
          lead => lead.assignedAgent && String(lead.assignedAgent) === agentIdStr
        ).length;

        const conversionRate = assignedCount > 0
          ? ((kycApprovedCount / assignedCount) * 100).toFixed(1) + '%'
          : '0.0%';

        return {
          agentId: agentIdStr,
          agentName: `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.phoneNumber || 'Sales Agent',
          phoneNumber: agent.phoneNumber || '',
          email: agent.email || '',
          assignedInDay: assignedCount,
          kycApprovedInDay: kycApprovedCount,
          deletedInDay: deletedCount,
          conversionRate
        };
      });
    }

    let agentStats = null;
    if (agentId) {
      // Calculate individual stats directly since we filtered assignedLeadsOnDate etc above
      agentStats = {
        agentId: String(agentId),
        agentName: 'Your Stats',
        assignedInDay: totalTeamAssigned,
        kycApprovedInDay: totalTeamKycApproved,
        deletedInDay: totalTeamDeleted,
        conversionRate: totalTeamAssigned > 0
          ? ((totalTeamKycApproved / totalTeamAssigned) * 100).toFixed(1) + '%'
          : '0.0%'
      };
    }

    // All-time complete database counts for Master Analytics Hub
    // If agentId is provided, we filter these counts to only include users assigned to that agent
    const allTimeFilter = {
      role: 'user',
      isDeleted: { $ne: true }
    };
    if (agentId) {
      allTimeFilter.assignedAgent = agentId;
    }

    const totalAllTimeUnassignedLeads = agentId ? 0 : await User.countDocuments({
      ...allTimeFilter,
      kycStatus: { $ne: 'verified' },
      $or: [
        { assignedAgent: null },
        { assignedAgent: { $exists: false } }
      ]
    });

    const totalAllTimeAssignedLeads = await User.countDocuments({
      ...allTimeFilter,
      kycStatus: { $ne: 'verified' },
      assignedAgent: agentId ? agentId : { $ne: null, $exists: true }
    });

    const totalAllTimeKycPendingLeads = await User.countDocuments({
      ...allTimeFilter,
      kycStatus: { $in: ['pending', 'submitted', 'processing'] }
    });

    const totalAllTimeVerifiedDealers = await User.countDocuments({
      ...allTimeFilter,
      kycStatus: 'verified'
    });

    const totalAllTimeDeletedLeads = await User.countDocuments({
      role: 'user',
      isDeleted: true,
      ...(agentId ? { assignedAgent: agentId } : {})
    });

    const totalAllTimeDeletedDealers = await User.countDocuments({
      role: 'dealer',
      isDeleted: true,
      ...(agentId ? { assignedAgent: agentId } : {})
    });

    // TRUE registrations today
    // For agents, "Registered Today" typically refers to leads assigned to them today
    const totalRegisteredToday = await User.countDocuments({
      role: 'user',
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      ...(agentId ? { assignedAgent: agentId } : {})
    });

    // How many of today's registrations are currently soft-deleted
    const registeredTodayNowDeleted = await User.countDocuments({
      role: 'user',
      isDeleted: true,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      ...(agentId ? { assignedAgent: agentId } : {})
    });

    return {
      date: targetDateStr,
      totalAllTimeUnassignedLeads,
      totalAllTimeAssignedLeads,
      totalAllTimeKycPendingLeads,
      totalAllTimeVerifiedDealers,
      totalDeletedLeads: totalAllTimeDeletedLeads,
      totalDeletedDealers: totalAllTimeDeletedDealers,
      // Accurate daily registration counts
      totalRegisteredToday,          // ALL who joined today (active + deleted)
      registeredTodayNowDeleted,     // Subset of above who are soft-deleted
      activeRegisteredToday: totalRegisteredToday - registeredTodayNowDeleted,
      teamStats: {
        totalAssignedInDay: totalTeamAssigned,
        totalKycApprovedInDay: totalTeamKycApproved,
        totalDeletedInDay: totalTeamDeleted
      },
      agentStats: agentStats || {
        agentId: null,
        agentName: 'All Sales Team',
        assignedInDay: totalTeamAssigned,
        kycApprovedInDay: totalTeamKycApproved,
        deletedInDay: totalTeamDeleted,
        conversionRate: totalTeamAssigned > 0 
          ? ((totalTeamKycApproved / totalTeamAssigned) * 100).toFixed(1) + '%' 
          : '0.0%'
      },
      agentBreakdown
    };
  }
}

module.exports = new UserService();
