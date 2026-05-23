const User = require('../models/User');
const notificationService = require('./notification.service');

class UserService {
  async getAllUsers(filters = {}) {
    // Optionally filter by role, kycStatus, etc.
    const query = {};
    if (filters.role) query.role = filters.role;
    if (filters.kycStatus) query.kycStatus = filters.kycStatus;
    
    return await User.find(query).select('-password').sort({ createdAt: -1 });
  }

  async getProfile(userId) {
    const user = await User.findById(userId);
    if (!user) {
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
      'cropTypes'
    ];
    const filteredUpdates = {};

    Object.keys(updateData).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updateData[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: filteredUpdates },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }

  async completeProfile(userId, profileData) {
    const { firstName, lastName, addressType, address } = profileData;

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
  async submitKyc(userId, kycData) {
    const { userType, shopName, gstNumber, licenceImage } = kycData;

    if (!userType || !shopName || !gstNumber) {
      throw new Error('User type, shop name, and GST number are required');
    }

    if (!licenceImage || typeof licenceImage !== 'string' || licenceImage.trim() === '') {
      throw new Error('Licence image is required');
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          userType,
          shopName,
          gstNumber,
          licenceImage,
          kycStatus: 'verified',
          isKycComplete: true
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
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.kycStatus = status;
    if (status === 'verified') {
      user.isKycComplete = true;
    } else if (status === 'rejected') {
      user.isKycComplete = false;
    }

    await user.save();

    // Trigger Notification
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
    ).catch(err => console.error("Error sending KYC notification:", err));

    return user;
  }
}

module.exports = new UserService();
