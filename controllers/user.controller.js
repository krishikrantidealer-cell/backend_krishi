const userService = require('../services/user.service');
const { processAndUploadKycDocument } = require('../utils/gcs');
const Notification = require('../models/Notification');
const { CRC32C_EXCEPTION_MESSAGES } = require('@google-cloud/storage');

exports.getProfile = async (req, res, next) => {
  try {
    const user = await userService.getProfile(req.user._id);
    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const user = await userService.updateProfile(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.completeProfile = async (req, res, next) => {
  try {
    const user = await userService.completeProfile(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Account created successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.submitKyc = async (req, res, next) => {
  try {
    const kycData = req.body;

    // Verify user can upload KYC (i.e. not verified or currently under review)
    const existingUser = await userService.getProfile(req.user._id);
    const hasSubmitted = existingUser.licenceImage && existingUser.licenceImage.trim() !== '';
    if (existingUser.isKycComplete || (hasSubmitted && existingUser.kycStatus !== 'rejected')) {
      return res.status(403).json({
        success: false,
        message: 'Documents under review'
      });
    }

    // Handle Optional/Fallback GCS Uploads
    let licenceImageUrl = existingUser.licenceImage;
    let shopImageUrl = existingUser.shopImage;

    const licenceFile = req.files && req.files['licenceImage'] ? req.files['licenceImage'][0] : null;
    const shopFile = req.files && req.files['shopImage'] ? req.files['shopImage'][0] : null;

    if (!licenceFile && (!licenceImageUrl || licenceImageUrl.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Licence image is required'
      });
    }

    if (!shopFile && (!shopImageUrl || shopImageUrl.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Shop image is required'
      });
    }

    const uploadPromises = [];

    if (licenceFile) {
      uploadPromises.push(
        processAndUploadKycDocument(
          licenceFile.buffer,
          licenceFile.originalname,
          req.user._id
        ).then(url => { licenceImageUrl = url; })
      );
    }

    if (shopFile) {
      uploadPromises.push(
        processAndUploadKycDocument(
          shopFile.buffer,
          shopFile.originalname,
          req.user._id
        ).then(url => { shopImageUrl = url; })
      );
    }

    await Promise.all(uploadPromises);

    // Add the GCS URLs to kycData before calling service
    kycData.licenceImage = licenceImageUrl;
    kycData.shopImage = shopImageUrl;

    const user = await userService.submitKyc(req.user._id, kycData);

    res.json({
      success: true,
      message: 'KYC submitted successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.addShippingAddress = async (req, res, next) => {
  try {
    const user = await userService.addShippingAddress(req.user._id, req.body);
    res.json({
      success: true,
      message: 'Address added successfully',
      addresses: user.shippingAddresses
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteShippingAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const user = await userService.deleteShippingAddress(req.user._id, addressId);
    res.json({
      success: true,
      message: 'Address deleted successfully',
      addresses: user.shippingAddresses
    });
  } catch (error) {
    next(error);
  }
};

exports.setDefaultAddress = async (req, res, next) => {
  try {
    const { addressId } = req.params;
    const user = await userService.setDefaultAddress(req.user._id, addressId);
    res.json({
      success: true,
      message: 'Default address updated',
      addresses: user.shippingAddresses
    });
  } catch (error) {
    next(error);
  }
};

exports.updateFcmToken = async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'fcmToken is required' });
    }
    await userService.updateFcmToken(req.user._id, fcmToken);
    res.json({ success: true, message: 'FCM Token updated successfully' });
  } catch (error) {
    next(error);
  }
};

exports.getMyNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, notifications });
  } catch (error) {
    next(error);
  }
};

/**
 * ADMIN CONTROLLERS
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const filters = {
      role: req.query.role,
      kycStatus: req.query.kycStatus
    };
    const users = await userService.getAllUsers(filters);
    res.json({ success: true, users });
  } catch (error) {
    next(error);
  }
};

exports.adminUpdateKycStatus = async (req, res, next) => {
  try {
    const { status, reason } = req.body;
    const { userId } = req.params;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be verified or rejected' });
    }

    const user = await userService.updateKycStatus(userId, status, reason);
    res.json({ success: true, message: `KYC status updated to ${status}`, user });
  } catch (error) {
    next(error);
  }
};

exports.adminAssignAgent = async (req, res, next) => {
  try {
    const { agentId } = req.body;
    const { userId } = req.params;

    const user = await userService.assignAgent(userId, agentId);
    res.json({ success: true, message: 'Agent assigned successfully', user });
  } catch (error) {
    next(error);
  }
};

exports.adminCreateSalesAgent = async (req, res, next) => {
  try {
    const user = await userService.createSalesAgent(req.body);
    res.status(201).json({
      success: true,
      message: 'Sales agent created successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
};
