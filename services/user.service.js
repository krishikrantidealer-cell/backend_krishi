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
          kycStatus: 'submitted',
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
}

module.exports = new UserService();
