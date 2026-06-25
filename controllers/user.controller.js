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

    try {
      const { sendToAll } = require('../services/websocket.service');
      sendToAll({ type: 'LEADS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast KYC submission:', wsErr.message);
    }

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
    if (req.user.role === 'sales') {
      filters.assignedAgent = req.user._id;
    }
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

    try {
      const { sendToAll, sendToUser } = require('../services/websocket.service');
      sendToAll({ type: 'LEADS_UPDATE' });
      sendToAll({ type: 'DEALERS_UPDATE' });
      if (user.assignedAgent) {
        sendToUser(user.assignedAgent.toString(), { type: 'LEADS_UPDATE' });
        sendToUser(user.assignedAgent.toString(), { type: 'DEALERS_UPDATE' });
      }
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast KYC status update:', wsErr.message);
    }

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

    try {
      const { sendToAll, sendToUser } = require('../services/websocket.service');
      sendToAll({ type: 'LEADS_UPDATE' });
      sendToAll({ type: 'DEALERS_UPDATE' });
      if (agentId) {
        sendToUser(agentId, { type: 'LEADS_UPDATE' });
        sendToUser(agentId, { type: 'DEALERS_UPDATE' });

        // Create database notification for the sales agent
        const isDealer = user.kycStatus === 'verified';
        const title = isDealer ? 'New Dealer Assigned 🤝' : 'New Lead Assigned 👤';
        const nameStr = (user.firstName || user.lastName)
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
          : user.shopName || user.phoneNumber;
        const body = isDealer 
          ? `You have been assigned to dealer: ${nameStr}.`
          : `You have been assigned to lead: ${nameStr}.`;

        await Notification.create({
          user: agentId,
          title,
          body,
          category: 'utility',
          actionRoute: isDealer ? '/dealers/profile' : '/leads/profile'
        });

        sendToUser(agentId, { type: 'NOTIFICATION_RECEIVED' });
      }
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast agent assignment:', wsErr.message);
    }

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

exports.adminUpdateSalesAgent = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const user = await userService.updateSalesAgent(agentId, req.body);
    res.json({
      success: true,
      message: 'Sales agent updated successfully',
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

exports.adminDeleteSalesAgent = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    await userService.deleteSalesAgent(agentId);
    res.json({
      success: true,
      message: 'Sales agent deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

exports.adminToggleBlockUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await userService.getProfile(userId);
    
    // Toggle block status
    user.isBlocked = !user.isBlocked;
    await user.save();

    const isBlockedNow = user.isBlocked;

    try {
      const { sendToUser, sendToAll } = require('../services/websocket.service');
      const notificationService = require('../services/notification.service');
      
      if (isBlockedNow) {
        // Force logout the blocked user
        sendToUser(userId, { type: 'FORCE_LOGOUT' });

        // Send Push / Utility Notification to the user themselves
        await notificationService.sendUtilityNotification(
          userId,
          'Account Suspended 🚫',
          'Your account has been suspended by the administrator. Contact support for assistance.',
          '/login'
        );

        // Notify assigned agent if any
        if (user.assignedAgent) {
          const agentIdStr = user.assignedAgent.toString();
          
          const title = 'Assigned User Blocked 🚫';
          const nameStr = (user.firstName || user.lastName) 
            ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
            : user.shopName || user.phoneNumber;
          const body = `${nameStr} has been blocked by the Administrator.`;
          
          await Notification.create({
            user: user.assignedAgent,
            title,
            body,
            category: 'utility',
            actionRoute: user.kycStatus === 'verified' ? '/dealers' : '/leads'
          });

          sendToUser(agentIdStr, { type: 'NOTIFICATION_RECEIVED' });
        }
      } else {
        // Send Push / Utility Notification to the user themselves when unblocked
        await notificationService.sendUtilityNotification(
          userId,
          'Account Reactivated 🔓',
          'Your account has been reactivated. You can now log back in.',
          '/login'
        );
      }
      
      // Notify all clients to update lead/dealer views
      sendToAll({ type: 'LEADS_UPDATE' });
      sendToAll({ type: 'DEALERS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Error in block propagation:', wsErr.message);
    }

    res.json({
      success: true,
      message: `User is now ${isBlockedNow ? 'blocked' : 'unblocked'}.`,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        isBlocked: user.isBlocked,
        kycStatus: user.kycStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.markNotificationsAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error) {
    next(error);
  }
};
