const User = require('../models/User');
const Contact = require('../models/Contact');
const Conversation = require('../models/Conversation');
const myoperatorService = require('../services/myoperator.service');

/**
 * Get retargeting lead cohorts based on inactivity duration and filter rules
 * Query parameters: cohort ('cart_48h', 'prospect_14d', 'lapsed_30d', 'dormant_90d'), language ('en', 'hi', 'ta', 'te', 'mr', 'kn', 'all')
 */
const getRetargetingCohorts = async (req, res) => {
  try {
    const { cohort = 'cart_48h', language = 'all' } = req.query;
    const now = new Date();

    let minDays = 2;
    let maxDays = 999;

    if (cohort === 'cart_48h') {
      minDays = 2;
      maxDays = 7;
    } else if (cohort === 'prospect_14d') {
      minDays = 7;
      maxDays = 30;
    } else if (cohort === 'lapsed_30d') {
      minDays = 30;
      maxDays = 90;
    } else if (cohort === 'dormant_90d') {
      minDays = 90;
      maxDays = 999;
    }

    const minDate = new Date(now.getTime() - maxDays * 24 * 60 * 60 * 1000);
    const maxDate = new Date(now.getTime() - minDays * 24 * 60 * 60 * 1000);

    const query = {
      updatedAt: { $gte: minDate, $lte: maxDate }
    };

    if (language && language !== 'all') {
      query.preferredLanguage = language;
    }

    // Role-based security for sales representatives
    if (req.user.role === 'sales') {
      query.assignedAgent = req.user.id;
    }

    const leads = await User.find(query)
      .select('firstName lastName shopName phoneNumber role preferredLanguage state city updatedAt assignedAgent')
      .populate('assignedAgent', 'firstName lastName')
      .limit(100);

    res.json({
      success: true,
      cohort,
      totalCount: leads.length,
      data: leads
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Execute multi-language targeted MyOperator WhatsApp template broadcast to a selected lead cohort
 */
const sendRetargetingBroadcast = async (req, res) => {
  try {
    const { userIds, templateName, defaultLanguage = 'en', bodyValues = [] } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please provide at least one target customer ID' });
    }

    if (!templateName) {
      return res.status(400).json({ success: false, message: 'Template name is required' });
    }

    const users = await User.find({ _id: { $in: userIds } });
    let successCount = 0;
    let failCount = 0;

    for (const u of users) {
      if (!u.phoneNumber) continue;
      try {
        const targetLang = u.preferredLanguage || defaultLanguage;

        await myoperatorService.sendMessage({
          phone: u.phoneNumber,
          type: 'Template',
          templateName,
          bodyValues: bodyValues.length > 0 ? bodyValues : [u.firstName || u.shopName || 'Customer'],
          languageCode: targetLang
        });
        successCount++;
      } catch (err) {
        console.error(`[Retargeting Broadcast] Failed for ${u.phoneNumber}:`, err.message);
        failCount++;
      }
    }

    res.json({
      success: true,
      message: `Broadcast completed. Sent: ${successCount}, Failed: ${failCount}`,
      successCount,
      failCount
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getRetargetingCohorts,
  sendRetargetingBroadcast
};
