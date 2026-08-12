const express = require('express');
const router = express.Router();
const cronService = require('../services/cron.service');
const pushNotificationSegmentService = require('../services/pushNotificationSegment.service');

const CRON_SECRET = process.env.CRON_SECRET || 'krishi_default_cron_secret_2026';

const verifyCronAuth = (req, res, next) => {
  const clientSecret = req.headers['x-cron-secret'] || req.query.secret;
  // Allow secret query param or header, or internal calls
  if (clientSecret && clientSecret === CRON_SECRET) {
    return next();
  }
  // In development mode, allow easy testing
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Unauthorized cron access' });
};

/**
 * @route   GET /api/cron/trigger
 * @desc    Triggers background cron tasks manually (used by Cloud Scheduler or Admin)
 * @query   job (optional: 9AM | 1130AM | 2PM | 530PM | 8PM | ALL)
 */
router.get('/trigger', verifyCronAuth, async (req, res) => {
  try {
    const job = req.query.job ? req.query.job.toUpperCase() : null;
    console.log(`[Cron Route] Manual cron trigger invoked (Job: ${job || 'ALL'})...`);

    // Run segment notification tasks
    cronService.runScheduledSegmentNotifications(job || null)
      .catch(e => console.error('[Cron Route Error] runScheduledSegmentNotifications:', e.message));

    // Also run maintenance tasks if job is ALL or unspecified
    if (!job || job === 'ALL') {
      cronService.runOrderSync().catch(e => console.error('[Cron Route Error] runOrderSync:', e.message));
      cronService.runAbandonedCartCheck().catch(e => console.error('[Cron Route Error] runAbandonedCartCheck:', e.message));
      cronService.runAbandonedCheckoutCheck().catch(e => console.error('[Cron Route Error] runAbandonedCheckoutCheck:', e.message));
      cronService.runKycUrgencyCheck().catch(e => console.error('[Cron Route Error] runKycUrgencyCheck:', e.message));
      cronService.runWhatsAppAutomation().catch(e => console.error('[Cron Route Error] runWhatsAppAutomation:', e.message));
    }

    return res.status(200).json({
      success: true,
      message: `Cron tasks triggered successfully (Job: ${job || 'Scheduled window / ALL'})`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/cron/segments-summary
 * @desc    Returns real-time diagnostics: eligible user count per audience segment
 */
router.get('/segments-summary', verifyCronAuth, async (req, res) => {
  try {
    const stats = await pushNotificationSegmentService.getSegmentStats();
    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/cron/segment/:segment
 * @desc    Manually triggers push notification for a specific segment (A to J, SEASONAL, URGENCY, TRUST)
 */
router.get('/segment/:segment', verifyCronAuth, async (req, res) => {
  try {
    const segment = req.params.segment.toUpperCase();
    console.log(`[Cron Route] Manual segment trigger for: ${segment}`);
    const result = await pushNotificationSegmentService.sendToSegment(segment);

    return res.status(200).json({
      success: true,
      segment,
      dispatchedCount: result.count,
      message: `Segment ${segment} processed. Sent to ${result.count} users.`
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
