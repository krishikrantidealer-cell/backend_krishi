
function interpolatePlaceholders(text, user) {
  if (!text || typeof text !== 'string') return text || '';
  const rawName = (user?.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : (user?.name || '')).trim();
  const dealerName = rawName || 'Dealer';
  const rawShopName = (user?.shopName || user?.businessName || user?.storeName || '').trim();
  const shopName = rawShopName || 'आपकी दुकान';

  return text
    .replace(/\{\{\s*name\s*\}\}/gi, dealerName)
    .replace(/\{\{\s*dealerName\s*\}\}/gi, dealerName)
    .replace(/\{\{\s*shopName\s*\}\}/gi, shopName)
    .replace(/\{\{\s*shopname\s*\}\}/gi, shopName)
    .replace(/\{\{\s*dukaan\s*\}\}/gi, shopName);
}

const NotificationCampaign = require('../models/NotificationCampaign');
const User = require('../models/User');
const pushNotificationSegmentService = require('../services/pushNotificationSegment.service');
const notificationService = require('../services/notification.service');

/**
 * Get all push campaigns with live eligible user counts
 */
exports.getAllCampaigns = async (req, res) => {
  try {
    const stats = await pushNotificationSegmentService.getSegmentStats();
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error fetching campaigns:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update Campaign Global Configuration (Enabled, Schedule Time, Mode, Pinned Template, Route)
 */
exports.updateCampaignConfig = async (req, res) => {
  try {
    const { segment } = req.params;
    const { isEnabled, scheduledTime, mode, pinnedTemplateId, targetRoute, name, description, templates } = req.body;

    const campaign = await NotificationCampaign.findOne({ segmentKey: segment.toUpperCase() });
    if (!campaign) {
      return res.status(404).json({ success: false, message: `Campaign for segment ${segment} not found.` });
    }

    if (isEnabled !== undefined) campaign.isEnabled = isEnabled;
    if (scheduledTime !== undefined) campaign.scheduledTime = scheduledTime;
    if (mode !== undefined) campaign.mode = mode;
    if (pinnedTemplateId !== undefined) campaign.pinnedTemplateId = pinnedTemplateId || null;
    if (targetRoute !== undefined) campaign.targetRoute = targetRoute;
    if (name !== undefined) campaign.name = name;
    if (description !== undefined) campaign.description = description;
    if (Array.isArray(templates)) campaign.templates = templates;

    await campaign.save();

    return res.status(200).json({
      success: true,
      message: `Segment ${segment.toUpperCase()} configuration updated successfully.`,
      campaign
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error updating campaign config:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Add a new Notification Template to a Segment
 */
exports.addTemplate = async (req, res) => {
  try {
    const { segment } = req.params;
    const { title, body, imageUrl, actionRoute, isEnabled } = req.body;

    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required.' });
    }

    const campaign = await NotificationCampaign.findOne({ segmentKey: segment.toUpperCase() });
    if (!campaign) {
      return res.status(404).json({ success: false, message: `Campaign for segment ${segment} not found.` });
    }

    const newTemplate = {
      title,
      body,
      imageUrl: imageUrl || '',
      actionRoute: actionRoute || campaign.targetRoute || '/dashboard',
      isEnabled: isEnabled !== undefined ? isEnabled : true,
      createdAt: new Date()
    };

    campaign.templates.push(newTemplate);
    await campaign.save();

    return res.status(201).json({
      success: true,
      message: 'Template added successfully.',
      campaign
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error adding template:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Edit an existing Notification Template
 */
exports.updateTemplate = async (req, res) => {
  try {
    const { segment, templateId } = req.params;
    const { title, body, imageUrl, actionRoute, isEnabled } = req.body;

    const campaign = await NotificationCampaign.findOne({ segmentKey: segment.toUpperCase() });
    if (!campaign) {
      return res.status(404).json({ success: false, message: `Campaign for segment ${segment} not found.` });
    }

    const template = campaign.templates.id(templateId);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    if (title !== undefined) template.title = title;
    if (body !== undefined) template.body = body;
    if (imageUrl !== undefined) template.imageUrl = imageUrl;
    if (actionRoute !== undefined) template.actionRoute = actionRoute;
    if (isEnabled !== undefined) template.isEnabled = isEnabled;

    await campaign.save();

    return res.status(200).json({
      success: true,
      message: 'Template updated successfully.',
      campaign
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error updating template:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a Notification Template
 */
exports.deleteTemplate = async (req, res) => {
  try {
    const { segment, templateId } = req.params;

    const campaign = await NotificationCampaign.findOne({ segmentKey: segment.toUpperCase() });
    if (!campaign) {
      return res.status(404).json({ success: false, message: `Campaign for segment ${segment} not found.` });
    }

    campaign.templates = campaign.templates.filter(t => t._id.toString() !== templateId);
    
    // If pinned template was deleted, reset pinned ID
    if (campaign.pinnedTemplateId && campaign.pinnedTemplateId.toString() === templateId) {
      campaign.pinnedTemplateId = null;
      campaign.mode = 'rotating';
    }

    await campaign.save();

    return res.status(200).json({
      success: true,
      message: 'Template deleted successfully.',
      campaign
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error deleting template:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Send a Test Notification to a specific phone number or user
 */
exports.sendTestNotification = async (req, res) => {
  try {
    const { segment } = req.params;
    const { phoneNumber, userId, customTitle, customBody, customImageUrl, customActionRoute } = req.body;

    let targetUser = null;
    if (phoneNumber) {
      targetUser = await User.findOne({ phoneNumber: phoneNumber.trim(), isDeleted: { $ne: true } });
    } else if (userId) {
      targetUser = await User.findById(userId);
    } else if (req.user) {
      targetUser = await User.findById(req.user._id);
    }

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found. Please provide a valid registered dealer phone number.'
      });
    }

    if (!targetUser.fcmToken) {
      return res.status(400).json({
        success: false,
        message: `User ${targetUser.phoneNumber || targetUser.firstName || targetUser._id} does not have an active FCM token registered (App might not be opened yet).`
      });
    }

    const campaign = await NotificationCampaign.findOne({ segmentKey: segment.toUpperCase() });
    const resolvedTemplate = await pushNotificationSegmentService.getNotificationForSegment(segment, targetUser);

    const rawTitle = customTitle || resolvedTemplate?.title || "Test Push Notification";
    const rawBody = customBody || resolvedTemplate?.body || "This is a test preview from Krishi Dealer Panel.";
    const title = interpolatePlaceholders(rawTitle, targetUser);
    const body = interpolatePlaceholders(rawBody, targetUser);
    const imageUrl = customImageUrl !== undefined ? customImageUrl : (resolvedTemplate?.image || resolvedTemplate?.imageUrl || "");
    const actionRoute = customActionRoute || resolvedTemplate?.actionRoute || campaign?.targetRoute || "/dashboard";

    const isUtility = ["A", "B", "C"].includes(segment.toUpperCase());
    if (isUtility) {
      await notificationService.sendUtilityNotification(targetUser._id, title, body, actionRoute, imageUrl);
    } else {
      await notificationService.sendMarketingNotification(targetUser._id, title, body, actionRoute, imageUrl);
    }

    return res.status(200).json({
      success: true,
      message: `Test push notification sent successfully to ${targetUser.firstName || 'Dealer'} (${targetUser.phoneNumber || targetUser._id}).`,
      details: { title, body, imageUrl, actionRoute }
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error sending test notification:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Trigger immediate segment broadcast
 */
exports.triggerSegmentNow = async (req, res) => {
  try {
    const { segment } = req.params;
    const { templateId } = req.body;

    let customTemplate = null;
    if (templateId) {
      const campaign = await NotificationCampaign.findOne({ segmentKey: segment.toUpperCase() });
      if (campaign) {
        const found = campaign.templates.id(templateId);
        if (found) {
          customTemplate = {
            title: found.title,
            body: found.body,
            image: found.imageUrl,
            imageUrl: found.imageUrl,
            actionRoute: found.actionRoute || campaign.targetRoute || "/dashboard"
          };
        }
      }
    }

    const result = await pushNotificationSegmentService.sendToSegment(segment.toUpperCase(), customTemplate);

    return res.status(200).json({
      success: true,
      segment: segment.toUpperCase(),
      dispatchedCount: result.count,
      message: `Segment ${segment.toUpperCase()} executed. Successfully sent to ${result.count} eligible dealers.`
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error triggering segment:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


/**
 * Upload banner image to GCS for push campaigns
 */
exports.uploadBannerImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided in upload request',
      });
    }

    const { uploadToGCS } = require('../utils/gcs');
    const cleanFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destination = `push_banners/${Date.now()}_${cleanFileName}`;
    const imageUrl = await uploadToGCS(req.file.buffer, destination, req.file.mimetype);

    // Also register in Banner model so it appears across admin banners
    try {
      const Banner = require('../models/Banner');
      await Banner.create({
        title: req.body.title || cleanFileName.replace(/.[^.]+$/, ''),
        imageUrl,
        type: 'marketing',
        isActive: true,
        priority: 10,
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      imageUrl,
      fileName: cleanFileName,
      message: 'Banner uploaded successfully',
    });
  } catch (error) {
    console.error('[MarketingCampaignController] Error uploading banner:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload banner image',
    });
  }
};
