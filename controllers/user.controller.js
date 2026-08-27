const userService = require('../services/user.service');
const User = require('../models/User');
const { processAndUploadKycDocument } = require('../utils/gcs');
const Notification = require('../models/Notification');
const auditService = require('../services/audit.service');

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
    const userId = req.user._id;

    // 1. Validate Files Presence and Types
    const licenceFile = req.files && req.files['licenceImage'] ? req.files['licenceImage'][0] : null;
    const shopFile = req.files && req.files['shopImage'] ? req.files['shopImage'][0] : null;

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

    if (licenceFile && !allowedMimeTypes.includes(licenceFile.mimetype)) {
      return res.status(400).json({ success: false, message: 'Invalid file type for license.' });
    }
    if (shopFile && !allowedMimeTypes.includes(shopFile.mimetype)) {
      return res.status(400).json({ success: false, message: 'Invalid file type for shop image.' });
    }

    // 2. Verify User Status
    const existingUser = await userService.getProfile(userId);
    const hasExistingLicence = existingUser.licenceImage && String(existingUser.licenceImage).trim() !== '' && String(existingUser.licenceImage) !== 'null';

    if (existingUser.isKycComplete || (hasExistingLicence && existingUser.kycStatus !== 'rejected' && !licenceFile && !shopFile)) {
      return res.status(403).json({
        success: false,
        message: 'KYC documents are already under review.'
      });
    }

    const userType = kycData.userType || existingUser.userType;
    let licenceImageUrl = existingUser.licenceImage;
    let shopImageUrl = existingUser.shopImage;

    if (!licenceFile && !hasExistingLicence) {
      return res.status(400).json({ success: false, message: 'Licence image is required' });
    }
    if (!shopFile && !(existingUser.shopImage && String(existingUser.shopImage).trim() !== '' && String(existingUser.shopImage) !== 'null')) {
      return res.status(400).json({ success: false, message: 'Shop image is required' });
    }

    // 3. Sequential Upload to GCS to avoid OOM on Cloud Run
    if (licenceFile) {
      try {
        licenceImageUrl = await processAndUploadKycDocument(licenceFile.buffer, licenceFile.originalname, userId);
      } catch (err) {
        console.error('[KYC] Licence upload failed:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to upload Licence to cloud storage.' });
      }
    }

    if (shopFile) {
      try {
        shopImageUrl = await processAndUploadKycDocument(shopFile.buffer, shopFile.originalname, userId);
      } catch (err) {
        console.error('[KYC] Shop upload failed:', err.message);
        return res.status(500).json({ success: false, message: 'Failed to upload Shop image to cloud storage.' });
      }
    }

    // 4. Update User Record
    kycData.licenceImage = licenceImageUrl;
    kycData.shopImage = shopImageUrl;

    const user = await userService.submitKyc(userId, kycData);

    // 5. Success Broadcast
    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });

      // Notify Admin via WhatsApp
      const whatsappService = require('../services/whatsapp.service');
      whatsappService.notifyKycSubmissionToAdmin(user);

      // Notify Admin via Database Notifications
      try {
        const nameStr = (user.firstName || user.lastName)
          ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
          : user.shopName || user.phoneNumber;
        const notificationService = require('../services/notification.service');
        await notificationService.notifyAdmins(
          'New KYC Submission 📄',
          `${nameStr} has submitted KYC documents for verification.`,
          '/leads'
        );
      } catch (notifErr) {
        console.error('[Notification] Failed to notify admins on KYC submission:', notifErr.message);
      }
    } catch (wsErr) {}

    return res.status(200).json({
      success: true,
      message: 'KYC submitted successfully',
      user: {
        _id: user._id,
        kycStatus: user.kycStatus
      }
    });
  } catch (error) {
    console.error('[KYC Critical Error]:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'An unexpected error occurred during KYC submission.' });
    }
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
      kycStatus: req.query.kycStatus,
      trash: req.query.trash,
      search: req.query.search,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      page: req.query.page,
      limit: req.query.limit
    };
    if (req.user.role === 'sales') {
      // Only scope to assignedAgent when querying leads/dealers, not when fetching list of sales agents
      if (req.query.role !== 'sales') {
        filters.assignedAgent = req.user._id;
      }
    }
    const { users, totalCount, hasMore } = await userService.getAllUsers(filters);
    res.json({ success: true, users, totalCount, hasMore });
  } catch (error) {
    next(error);
  }
};

exports.getUserById = async (req, res, next) => {
  try {
    // Admins and sales can see profiles even if marked as deleted (e.g. from trash)
    const user = await userService.getProfile(req.params.userId, true);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Role Security: Sales agents can ONLY view profile details for leads/dealers assigned to them
    if (req.user.role === 'sales' && user.assignedAgent && String(user.assignedAgent._id || user.assignedAgent) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Access Denied: You can only view leads or dealers assigned to you.' });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.adminUpdateKycStatus = async (req, res, next) => {
  try {
    const rawStatus = req.body.status || req.body.kycStatus;
    const reason = req.body.reason || req.body.rejectionReason || req.body.kycReason || '';
    const { userId } = req.params;

    if (!rawStatus) {
      return res.status(400).json({ success: false, message: 'Status is required (e.g. verified or rejected)' });
    }

    const lower = rawStatus.toString().toLowerCase().trim();
    const status = (lower === 'dealer' || lower === 'verified' || lower === 'approve' || lower === 'approved') ? 'verified' : (lower === 'reject' || lower === 'rejected' ? 'rejected' : lower);

    if (!['verified', 'rejected', 'processing', 'submitted', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be verified or rejected' });
    }

    // Get old user state for audit logging
    let oldUser = null;
    try {
      oldUser = await userService.getProfile(userId);
    } catch (e) {
      console.error('[Audit] Failed to fetch old user profile for KYC diff:', e.message);
    }

    const user = await userService.updateKycStatus(userId, status, reason);

    // Notify User via WhatsApp & Push
    try {
      const whatsappAutomationService = require('../services/whatsappAutomation.service');
      const notificationService = require('../services/notification.service');

      if (status === 'verified') {
        await whatsappAutomationService.notifyKycApproved(user);
        await notificationService.sendUtilityNotification(
          userId,
          'KYC Approved! 🎉',
          'Your account is now verified. You can now see wholesale rates and place orders.',
          '/profile'
        );
      } else {
        const whatsappService = require('../services/whatsapp.service');
        await whatsappService.notifyKycStatusUpdate(user, status, reason);
      }
    } catch (waErr) {
      console.error('[Notification] Failed to notify user of KYC update:', waErr.message);
    }

    // Audit critical sales/admin action
    try {
      auditService.logAction({
        adminId: req.user._id,
        adminEmail: req.user.email,
        action: `KYC_${status.toUpperCase()}`,
        targetId: user._id,
        targetModel: 'User',
        changes: {
          before: { kycStatus: oldUser ? oldUser.kycStatus : null, reason: oldUser ? (oldUser.kycReason || oldUser.reason || '') : '' },
          after: { kycStatus: status, reason }
        }
      }, req);
    } catch (auditErr) {
      console.error('[Audit] Failed to log KYC status update:', auditErr.message);
    }

    try {
      const { broadcastToRoles, sendToUser } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
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
    const rawAgentId = req.body.agentId !== undefined
      ? req.body.agentId
      : (req.body.assignedAgentId !== undefined ? req.body.assignedAgentId : req.body.assignedAgent);
    const agentId = (rawAgentId && rawAgentId !== 'unassign' && String(rawAgentId).trim() !== '' && String(rawAgentId).trim() !== 'null')
      ? rawAgentId
      : null;
    const { userId } = req.params;

    // Get old user state for audit logging
    let oldUser = null;
    try {
      oldUser = await userService.getProfile(userId);
    } catch (e) {
      console.error('[Audit] Failed to fetch old user profile for assignment diff:', e.message);
    }

    const user = await userService.assignAgent(userId, agentId);

    // Sync WhatsApp CRM Contact and Conversation assignments to match this change
    if (user && user.phoneNumber) {
      try {
        const Contact = require('../models/Contact');
        const Conversation = require('../models/Conversation');
        const cleanPhone = user.phoneNumber.replace(/[^\d]/g, '');
        const contact = await Contact.findOneAndUpdate(
          {
            $or: [
              { phone: cleanPhone },
              { phone: `91${cleanPhone}` },
              { phone: `+91${cleanPhone}` }
            ]
          },
          { assignedTo: agentId },
          { new: true }
        );
        if (contact) {
          await Conversation.findOneAndUpdate(
            { contactId: contact._id },
            { assignedTo: agentId }
          );
        }
      } catch (err) {
        console.error('[Sync] Failed to sync WhatsApp contact/conversation assignment:', err.message);
      }
    }

    // Audit critical sales/admin action
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'AGENT_ASSIGNED',
      targetId: userId,
      targetModel: 'User',
      changes: {
        before: { assignedAgent: oldUser ? oldUser.assignedAgent : null },
        after: { assignedAgent: agentId }
      }
    }, req);

    try {
      const { broadcastToRoles, sendToUser } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
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

    // Audit Log: Sales Agent Created
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'SALES_AGENT_CREATED',
      targetId: user._id,
      targetModel: 'User',
      changes: { after: { email: user.email, role: user.role } }
    }, req);

    res.status(201).json({
      success: true,
      message: 'Sales agent created successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        monthlyTarget: user.monthlyTarget,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.adminUpdateSalesAgent = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const oldAgent = await userService.getProfile(agentId);
    const user = await userService.updateSalesAgent(agentId, req.body);

    // Audit Log: Sales Agent Updated
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'SALES_AGENT_UPDATED',
      targetId: agentId,
      targetModel: 'User',
      changes: {
        before: { email: oldAgent.email, role: oldAgent.role },
        after: { email: user.email, role: user.role }
      }
    }, req);

    res.json({
      success: true,
      message: 'Sales agent updated successfully',
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        monthlyTarget: user.monthlyTarget,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.adminDeleteSalesAgent = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const targetAgent = await userService.getProfile(agentId);

    await userService.deleteSalesAgent(agentId);

    // Audit Log: Sales Agent Deleted
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'SALES_AGENT_DELETED',
      targetId: agentId,
      targetModel: 'User',
      changes: { before: { email: targetAgent.email, role: targetAgent.role } }
    }, req);

    res.json({
      success: true,
      message: 'Sales agent deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

exports.adminSubmitKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const kycData = req.body;

    const existingUser = await userService.getProfile(userId);
    let licenceImageUrl = existingUser.licenceImage;
    let shopImageUrl = existingUser.shopImage;

    const licenceFile = req.files && req.files['licenceImage'] ? req.files['licenceImage'][0] : null;
    const shopFile = req.files && req.files['shopImage'] ? req.files['shopImage'][0] : null;

    const uploadPromises = [];

    if (licenceFile) {
      uploadPromises.push(
        processAndUploadKycDocument(
          licenceFile.buffer,
          licenceFile.originalname,
          userId
        ).then(url => { licenceImageUrl = url; })
      );
    }

    if (shopFile) {
      uploadPromises.push(
        processAndUploadKycDocument(
          shopFile.buffer,
          shopFile.originalname,
          userId
        ).then(url => { shopImageUrl = url; })
      );
    }

    await Promise.all(uploadPromises);

    kycData.licenceImage = licenceImageUrl;
    kycData.shopImage = shopImageUrl;

    const keepVerified = existingUser.kycStatus === 'verified';
    const user = await userService.submitKyc(userId, kycData, keepVerified);

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast admin KYC submission:', wsErr.message);
    }

    res.json({
      success: true,
      message: 'KYC submitted successfully by Admin',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.createDealer = async (req, res, next) => {
  try {
    let {
      phoneNumber,
      firstName,
      lastName,
      shopName,
      gstNumber,
      email,
      address,
      assignedAgent,
      notes
    } = req.body;

    // Support multipart stringified address
    let parsedAddress = address;
    if (typeof address === 'string') {
      try {
        parsedAddress = JSON.parse(address);
      } catch (e) {
        parsedAddress = {};
      }
    }

    // Clean phone number
    let cleanPhone = String(phoneNumber || '').replace(/[^\d]/g, '');
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      cleanPhone = cleanPhone.substring(2);
    } else if (cleanPhone.startsWith('0') && cleanPhone.length === 11) {
      cleanPhone = cleanPhone.substring(1);
    }

    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit phone number is required' });
    }

    // Determine assigned agent
    const mongoose = require('mongoose');
    let targetAgentId = null;
    if (req.user.role === 'sales') {
      targetAgentId = req.user._id;
    } else if (assignedAgent && String(assignedAgent).trim() !== '' && String(assignedAgent) !== '-' && String(assignedAgent) !== 'null' && String(assignedAgent) !== 'undefined') {
      if (mongoose.Types.ObjectId.isValid(assignedAgent)) {
        targetAgentId = new mongoose.Types.ObjectId(assignedAgent);
      }
    }

    // Check if user already exists
    let existingUser = await User.findOne({ phoneNumber: cleanPhone });

    // Handle KYC image uploads if any
    const licenceFile = req.files && req.files['licenceImage'] ? req.files['licenceImage'][0] : null;
    const shopFile = req.files && req.files['shopImage'] ? req.files['shopImage'][0] : null;

    let licenceImageUrl = existingUser?.licenceImage;
    let shopImageUrl = existingUser?.shopImage;
    const uploadPromises = [];

    if (licenceFile) {
      uploadPromises.push(
        processAndUploadKycDocument(
          licenceFile.buffer,
          licenceFile.originalname,
          existingUser ? existingUser._id.toString() : cleanPhone
        ).then(url => { licenceImageUrl = url; })
      );
    }

    if (shopFile) {
      uploadPromises.push(
        processAndUploadKycDocument(
          shopFile.buffer,
          shopFile.originalname,
          existingUser ? existingUser._id.toString() : cleanPhone
        ).then(url => { shopImageUrl = url; })
      );
    }

    if (uploadPromises.length > 0) {
      await Promise.all(uploadPromises);
    }

    if (existingUser) {
      if (existingUser.kycStatus === 'verified') {
        return res.status(400).json({
          success: false,
          message: `A verified dealer with phone ${cleanPhone} already exists (${existingUser.shopName || existingUser.firstName}).`
        });
      }

      // Upgrade existing lead/prospect to verified dealer
      existingUser.firstName = firstName || existingUser.firstName;
      existingUser.lastName = lastName !== undefined ? lastName : existingUser.lastName;
      existingUser.shopName = shopName || existingUser.shopName;
      if (gstNumber) existingUser.gstNumber = gstNumber;
      if (email && !existingUser.email) existingUser.email = email;
      if (licenceImageUrl) existingUser.licenceImage = licenceImageUrl;
      if (shopImageUrl) existingUser.shopImage = shopImageUrl;
      if (parsedAddress) {
        existingUser.address = {
          ...existingUser.address,
          ...parsedAddress
        };
      }
      existingUser.role = 'user';
      existingUser.userType = 'retailer';
      existingUser.kycStatus = 'verified';
      existingUser.isKycComplete = true;
      existingUser.isVerified = true;
      existingUser.status = 'verified';
      existingUser.kycApprovedAt = new Date();
      existingUser.isPanelCreated = true;
      existingUser.createdVia = existingUser.createdVia && existingUser.createdVia !== 'app' ? existingUser.createdVia : 'lead_conversion';
      if (!existingUser.source || existingUser.source === 'App') {
        existingUser.source = 'KD Panel';
      }
      if (targetAgentId) {
        existingUser.assignedAgent = targetAgentId;
        existingUser.assignedAt = new Date();
      }

      const creatorName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Admin';
      existingUser.createdByAdminId = existingUser.createdByAdminId || req.user._id;
      existingUser.createdByAdminName = existingUser.createdByAdminName || creatorName;
      existingUser.createdByRole = existingUser.createdByRole || req.user.role;
      const creationNote = notes || `Upgraded to Verified Dealer directly from KD Panel by ${creatorName}`;
      existingUser.notes = existingUser.notes ? `${existingUser.notes}\n\n${creationNote}` : creationNote;
      existingUser.notesHistory = existingUser.notesHistory || [];
      existingUser.notesHistory.push({
        title: 'Upgraded to Dealer in KD Panel',
        note: creationNote,
        adminId: req.user._id,
        adminName: creatorName,
        createdAt: new Date(),
        type: 'general',
        priority: 'high',
        status: 'verified'
      });

      await existingUser.save();

      // Audit Log
      try {
        auditService.logAction({
          adminId: req.user._id,
          adminEmail: req.user.email,
          action: 'LEAD_UPGRADED_TO_DEALER',
          targetId: existingUser._id,
          targetModel: 'User',
          details: `Lead ${cleanPhone} upgraded to verified dealer by ${creatorName}`,
        }, req);
      } catch (e) {}

      // WebSockets
      try {
        const { broadcastToRoles, sendToUser } = require('../services/websocket.service');
        broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
        broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
        if (targetAgentId) {
          sendToUser(targetAgentId.toString(), { type: 'DEALERS_UPDATE' });
        }
      } catch (wsErr) {}

      const populatedUser = await User.findById(existingUser._id).populate('assignedAgent', 'firstName lastName phoneNumber email');

      return res.status(200).json({
        success: true,
        message: 'Existing lead upgraded to verified dealer successfully',
        user: populatedUser || existingUser
      });
    }

    // New User creation
    const creatorName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Admin';
    const creationNote = notes || `Created as Verified Dealer directly from KD Panel by ${creatorName}`;

    const newDealer = await User.create({
      phoneNumber: cleanPhone,
      email: email && email.trim() !== '' ? email.trim() : undefined,
      firstName: firstName.trim(),
      lastName: (lastName || '').trim(),
      shopName: shopName.trim(),
      gstNumber: gstNumber ? gstNumber.trim() : undefined,
      licenceImage: licenceImageUrl,
      shopImage: shopImageUrl,
      address: {
        villageArea: parsedAddress?.villageArea || '',
        addressLine2: parsedAddress?.addressLine2 || '',
        address2: parsedAddress?.address2 || '',
        cityTehsil: parsedAddress?.cityTehsil || '',
        state: parsedAddress?.state || '',
        pincode: parsedAddress?.pincode || ''
      },
      addressType: 'Shop',
      role: 'user',
      userType: 'retailer',
      kycStatus: 'verified',
      isKycComplete: true,
      isVerified: true,
      isProfileComplete: true,
      source: 'KD Panel',
      isPanelCreated: true,
      createdVia: 'panel',
      createdByAdminId: req.user._id,
      createdByAdminName: creatorName,
      createdByRole: req.user.role,
      status: 'verified',
      monthlyTarget: 500000,
      preferredLanguage: 'en',
      isBlocked: false,
      isDeleted: false,
      whatsappSequence: 0,
      shippingAddresses: [],
      assignedAgent: targetAgentId || null,
      assignedAt: targetAgentId ? new Date() : null,
      kycApprovedAt: new Date(),
      notes: creationNote,
      notesHistory: [
        {
          title: 'Dealer Created in KD Panel',
          note: creationNote,
          adminId: req.user._id,
          adminName: creatorName,
          createdAt: new Date(),
          type: 'general',
          priority: 'high',
          status: 'verified'
        }
      ]
    });

    // Audit Log
    try {
      auditService.logAction({
        adminId: req.user._id,
        adminEmail: req.user.email,
        action: 'DEALER_CREATED',
        targetId: newDealer._id,
        targetModel: 'User',
        details: `Created verified dealer ${cleanPhone} (${newDealer.shopName}) by ${creatorName}`,
      }, req);
    } catch (e) {}

    // Broadcast WebSockets
    try {
      const { broadcastToRoles, sendToUser } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      if (targetAgentId) {
        sendToUser(targetAgentId.toString(), { type: 'DEALERS_UPDATE' });
      }
    } catch (wsErr) {}

    const populatedDealer = await User.findById(newDealer._id).populate('assignedAgent', 'firstName lastName phoneNumber email');

    res.status(201).json({
      success: true,
      message: 'Dealer created successfully',
      user: populatedDealer || newDealer
    });
  } catch (error) {
    next(error);
  }
};

exports.adminUpdateUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const updateData = { ...req.body };

    // Pass admin info for notes history
    updateData.adminId = req.user._id;
    updateData.adminName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Admin';

    // Get old user state for audit logging
    let oldUser = null;
    try {
      oldUser = await userService.getProfile(userId);
    } catch (e) {
      console.error('[Audit] Failed to fetch old user profile for diff:', e.message);
    }

    const user = await userService.updateProfile(userId, updateData);

    // Compute diff for audit log
    const beforeChanges = {};
    const afterChanges = {};
    if (oldUser) {
      const oldUserObj = typeof oldUser.toObject === 'function' ? oldUser.toObject() : oldUser;
      Object.keys(req.body).forEach(key => {
        let oldVal;
        let newVal = req.body[key];
        if (key === 'leadStatus') {
          oldVal = oldUserObj.status;
        } else if (key === 'leadNotes') {
          oldVal = oldUserObj.notes;
        } else {
          oldVal = oldUserObj[key];
        }

        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          beforeChanges[key] = oldVal;
          afterChanges[key] = newVal;
        }
      });
    }

    // Audit critical sales/admin action
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'USER_PROFILE_UPDATED',
      targetId: userId,
      targetModel: 'User',
      changes: {
        before: beforeChanges,
        after: afterChanges
      }
    }, req);

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast user update:', wsErr.message);
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.adminDeleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const targetUser = await userService.getProfile(userId);

    // Authorization check for sales agents
    if (req.user.role === 'sales') {
      if (!targetUser.assignedAgent || targetUser.assignedAgent.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this user. Only assigned agents or admins can delete.'
        });
      }
    }

    // Soft delete via service with admin metadata
    const adminName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Admin';
    await userService.deleteUser(userId, req.user._id, adminName);

    // Audit Log: Lead/Dealer Deleted
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'USER_DELETED',
      targetId: userId,
      targetModel: 'User',
      changes: { before: {
        name: `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim(),
        phone: targetUser.phoneNumber,
        kycStatus: targetUser.kycStatus
      } }
    }, req);

    try {
      const { sendToUser, broadcastToRoles } = require('../services/websocket.service');
      sendToUser(userId, { type: 'FORCE_LOGOUT' });
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast user deletion / force logout:', wsErr.message);
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

exports.adminRestoreUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const User = require('../models/User');
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Authorization check for sales agents
    if (req.user.role === 'sales') {
      if (!targetUser.assignedAgent || targetUser.assignedAgent.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to restore this user. Only assigned agents or admins can restore.'
        });
      }
    }

    const restoredUser = await userService.restoreUser(userId);

    // Audit Log: Lead/Dealer Restored
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'USER_RESTORED',
      targetId: userId,
      targetModel: 'User',
      changes: { after: {
        name: `${restoredUser.firstName || ''} ${restoredUser.lastName || ''}`.trim(),
        phone: restoredUser.phoneNumber,
        kycStatus: restoredUser.kycStatus
      } }
    }, req);

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast user restoration:', wsErr.message);
    }

    res.json({
      success: true,
      message: 'User restored successfully',
      user: restoredUser
    });
  } catch (error) {
    next(error);
  }
};

exports.adminPermanentlyDeleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const User = require('../models/User');
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Authorization check for sales agents
    if (req.user.role === 'sales') {
      if (!targetUser.assignedAgent || targetUser.assignedAgent.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this user. Only assigned agents or admins can delete.'
        });
      }
    }

    await userService.permanentlyDeleteUser(userId);

    // Audit Log: Lead/Dealer Permanently Deleted
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'USER_PERMANENTLY_DELETED',
      targetId: userId,
      targetModel: 'User',
      changes: { before: {
        name: `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim(),
        phone: targetUser.phoneNumber,
        kycStatus: targetUser.kycStatus
      } }
    }, req);

    try {
      const { sendToUser, broadcastToRoles } = require('../services/websocket.service');
      sendToUser(userId, { type: 'FORCE_LOGOUT' });
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast user permanent deletion / force logout:', wsErr.message);
    }

    res.json({
      success: true,
      message: 'User permanently deleted'
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

    // Audit Log: User Blocked/Unblocked
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: isBlockedNow ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      targetId: userId,
      targetModel: 'User',
      changes: {
        before: { isBlocked: !isBlockedNow },
        after: { isBlocked: isBlockedNow }
      }
    }, req);

    try {
      const { sendToUser, broadcastToRoles } = require('../services/websocket.service');
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
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
      broadcastToRoles(['admin', 'sales'], { type: 'DEALERS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Error in block propagation:', wsErr.message);
    }

    res.json({
      success: true,
      message: `User is now ${isBlockedNow ? 'blocked' : 'unblocked'}.`,
      user: {
        _id: user._id,
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
    const { notificationId } = req.body;
    if (notificationId) {
      await Notification.updateOne(
        { _id: notificationId, user: req.user._id, isRead: false },
        { $set: { isRead: true } }
      );
    } else {
      await Notification.updateMany(
        { user: req.user._id, isRead: false },
        { $set: { isRead: true } }
      );
    }
    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error) {
    next(error);
  }
};

exports.deleteSelfAccount = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const nameStr = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'User';
    await userService.deleteUser(userId, userId, nameStr);

    // Audit Log: Account Self-Deleted
    auditService.logAction({
      adminId: userId,
      adminEmail: req.user.email || 'self-delete',
      action: 'ACCOUNT_SELF_DELETED',
      targetId: userId,
      targetModel: 'User',
      changes: { before: { name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(), phone: req.user.phoneNumber } }
    }, req);

    try {
      const { sendToAll } = require('../services/websocket.service');
      sendToAll({ type: 'LEADS_UPDATE' });
    } catch (wsErr) {
      console.error('[WS] Failed to broadcast user self-deletion:', wsErr.message);
    }

    // Notify admins of account deletion
    try {
      const nameStr = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.phoneNumber || 'User';
      const notificationService = require('../services/notification.service');
      await notificationService.notifyAdmins(
        'Account Self-Deleted ⚠️',
        `${nameStr} has deleted their account.`,
        '/logs'
      );
    } catch (notifErr) {
      console.error('[Notification] Failed to notify admins on self-deletion:', notifErr.message);
    }

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// ─── Admin: Create Notification for a specific user ───────────────────────────
// POST /api/users/notifications/send
// Body: { recipient, title, body, type }
exports.createNotification = async (req, res, next) => {
  try {
    const { recipient, title, body, message, type } = req.body;

    if (!recipient || !title) {
      res.status(400);
      throw new Error('recipient and title are required');
    }

    const notifBody = body || message || '';

    // Persist to database so the agent sees it in the notification bell
    const notification = await Notification.create({
      user: recipient,
      title,
      body: notifBody,
      category: 'utility',
    });

    // Push real-time WebSocket event so the agent's topbar refreshes immediately
    try {
      const { sendToUser } = require('../services/websocket.service');
      sendToUser(recipient.toString(), { type: 'NOTIFICATION_RECEIVED' });
    } catch (wsErr) {
      console.error('[WS] Failed to push NOTIFICATION_RECEIVED to user:', wsErr.message);
    }

    console.log(`[Notification] Created for user ${recipient} — type: ${type || 'admin_note'} | title: "${title}"`);

    res.status(201).json({
      success: true,
      message: 'Notification sent successfully',
      notification,
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    const { notificationId } = req.params;

    if (notificationId === 'all') {
      // Delete all notifications for this user
      await Notification.deleteMany({ user: req.user._id });
      return res.json({ success: true, message: 'All notifications deleted' });
    }

    // Delete a single notification belonging to this user
    const deleted = await Notification.findOneAndDelete({
      _id: notificationId,
      user: req.user._id,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
};

exports.adminBulkCreateUsers = async (req, res, next) => {
  try {
    const { users } = req.body;

    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ success: false, message: 'Users array is required' });
    }

    const User = require('../models/User');
    const results = {
      success: [],
      failed: [],
    };

    const seenPhones = new Set();
    const seenEmails = new Set();

    for (const userData of users) {
      try {
        // Validate minimal requirement: phoneNumber
        if (!userData.phoneNumber) {
          results.failed.push({ data: userData, reason: 'Phone number is required' });
          continue;
        }

        const phoneNumber = String(userData.phoneNumber).trim();
        const email = userData.email ? String(userData.email).trim().toLowerCase() : null;

        // Check for duplicates within the current uploaded batch
        if (seenPhones.has(phoneNumber)) {
          results.failed.push({ data: userData, reason: 'Duplicate phone number within the uploaded batch' });
          continue;
        }
        if (email && seenEmails.has(email)) {
          results.failed.push({ data: userData, reason: 'Duplicate email within the uploaded batch' });
          continue;
        }

        // Check if user already exists in the database
        const existingUser = await User.findOne({
          $or: [
            { phoneNumber },
            ...(email ? [{ email }] : [])
          ]
        });

        if (existingUser) {
          results.failed.push({ data: userData, reason: 'User with this phone/email already exists' });
          continue;
        }

        // Mark as seen in this batch
        seenPhones.add(phoneNumber);
        if (email) seenEmails.add(email);

        const newUser = await User.create({
          ...userData,
          phoneNumber,
          email: email || undefined,
          role: userData.role || 'user',
          isVerified: true,
          isProfileComplete: !!(userData.firstName && userData.lastName),
          source: userData.source || 'Bulk Import',
          status: userData.status || 'prospect',
          kycStatus: userData.kycStatus || 'pending',
          ...(req.user.role === 'sales' ? { assignedAgent: req.user._id } : {}),
        });

        results.success.push(newUser._id);
      } catch (err) {
        results.failed.push({ data: userData, reason: err.message });
      }
    }

    // Log Activity
    try {
      auditService.logAction({
        adminId: req.user._id,
        adminEmail: req.user.email,
        action: 'BULK_USER_IMPORT',
        targetModel: 'User',
        details: `Imported ${results.success.length} users via bulk upload. ${results.failed.length} failed.`,
      }, req);
    } catch (auditErr) {
      console.error('[Audit] Failed to log bulk import:', auditErr.message);
    }

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'LEADS_UPDATE' });
    } catch (wsErr) {}

    res.json({
      success: true,
      message: `Successfully imported ${results.success.length} users. ${results.failed.length} failed.`,
      results,
    });
  } catch (error) {
    next(error);
  }
};

exports.getDailyLeadStats = async (req, res, next) => {
  try {
    const { date, agentId } = req.query;
    
    // Sales role security restriction: if user is a sales agent, force agentId filter to their own ID unless admin
    let selectedAgentId = agentId || null;
    if (req.user && req.user.role === 'sales') {
      selectedAgentId = req.user._id;
    }

    const stats = await userService.getDailyLeadStats({
      dateStr: date,
      agentId: selectedAgentId
    });

    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    next(error);
  }
};




