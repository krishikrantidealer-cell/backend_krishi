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

  async getProfile(userId) {
    const user = await User.findById(userId);
    if (!user || user.isDeleted) {
      throw new Error('User not found');
    }
    return user;
  }

  async updateProfile(userId, updateData) {
    // Only allow specific fields to be updated
    const allowedUpdates = [
      'firstName',
      'lastName',
      'profileImage',
      'addressType',
      'address',
      'shopName',
      'gstNumber',
      'farmSize',
      'cropTypes',
      'status',
      'notes',
      'leadStatus',
      'leadNotes'
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
        createdAt: new Date()
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
    const { firstName, lastName, addressType, address, source, deepLinkUrl } = profileData;

    if (!firstName || !lastName || !addressType || !address) {
      throw new Error('All profile fields are required');
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          firstName,
          lastName,
          addressType,
          address,
          source: source || 'App',
          deepLinkUrl: deepLinkUrl || null,
          isProfileComplete: true,
          isVerified: true
        }
      },
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

    const updateData = {
      kycStatus: status,
      isKycComplete: status === 'verified',
      isVerified: status === 'verified',
      status: status === 'verified' ? 'verified' : (status === 'rejected' ? 'rejected' : status)
    };

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

      // When assigned to a sales agent, a 'prospect' lead becomes 'new'
      if (user.status === 'prospect') {
        user.status = 'new';
      }
    } else {
      user.assignedAgent = null;
    }

    await user.save();
    return await User.findById(userId).populate('assignedAgent', 'firstName lastName phoneNumber email');
  }

  async createSalesAgent(agentData) {
    const { firstName, lastName, email, phoneNumber, password } = agentData;

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
      role: 'sales',
      isVerified: true,
      isProfileComplete: true
    });

    return user;
  }

  async updateSalesAgent(agentId, updateData) {
    const { firstName, lastName, email, phoneNumber, password } = updateData;

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
    return true;
  }

  async deleteUser(userId) {
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
    await user.save();
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
    return true;
  }
}

module.exports = new UserService();
