const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/marketingCampaign.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

// Protect all marketing campaign endpoints for admin/sales
router.use(protect);
router.use(authorizeRoles('admin', 'sales'));

/**
 * @route   GET /api/marketing/push-campaigns
 * @desc    Get all push notification campaigns, active templates, and live audience stats
 */
router.get('/', campaignController.getAllCampaigns);

/**
 * @route   PUT /api/marketing/push-campaigns/:segment/config
 * @desc    Update campaign global settings (enabled, schedule time, mode, pinned template)
 */
router.put('/:segment/config', campaignController.updateCampaignConfig);

/**
 * @route   POST /api/marketing/push-campaigns/:segment/templates
 * @desc    Add a new notification copy/template to a segment
 */
router.post('/:segment/templates', campaignController.addTemplate);

/**
 * @route   PUT /api/marketing/push-campaigns/:segment/templates/:templateId
 * @desc    Edit an existing template
 */
router.put('/:segment/templates/:templateId', campaignController.updateTemplate);

/**
 * @route   DELETE /api/marketing/push-campaigns/:segment/templates/:templateId
 * @desc    Delete a template
 */
router.delete('/:segment/templates/:templateId', campaignController.deleteTemplate);

/**
 * @route   POST /api/marketing/push-campaigns/:segment/send-test
 * @desc    Send instant test notification to a specific phone number or user
 */
router.post('/:segment/send-test', campaignController.sendTestNotification);

/**
 * @route   POST /api/marketing/push-campaigns/:segment/trigger-now
 * @desc    Manually trigger instant broadcast for the entire segment
 */
router.post('/:segment/trigger-now', campaignController.triggerSegmentNow);

module.exports = router;
