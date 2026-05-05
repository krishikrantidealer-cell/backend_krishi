const User = require('../models/User');

class UserService {
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
}

module.exports = new UserService();
