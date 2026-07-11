const express = require('express');
const router = express.Router();
const cronService = require('../services/cron.service');

/**
 * @route   GET /api/cron/trigger
 * @desc    Triggers background cron tasks manually (used by Cloud Scheduler)
 * @access  Private (Requires secret token verification)
 */
router.get('/trigger', async (req, res) => {
  const CRON_SECRET = process.env.CRON_SECRET || 'krishi_default_cron_secret_2026';
  const clientSecret = req.headers['x-cron-secret'] || req.query.secret;

  if (clientSecret !== CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    console.log('[Cron Route] Triggering background cron tasks...');

    // Run tasks in background/asynchronously to prevent HTTP timeout errors
    cronService.runOrderSync().catch(e => console.error('[Cron Route Error] runOrderSync:', e.message));
    cronService.runAbandonedCartCheck().catch(e => console.error('[Cron Route Error] runAbandonedCartCheck:', e.message));
    cronService.runAbandonedCheckoutCheck().catch(e => console.error('[Cron Route Error] runAbandonedCheckoutCheck:', e.message));
    cronService.runKycUrgencyCheck().catch(e => console.error('[Cron Route Error] runKycUrgencyCheck:', e.message));
    cronService.runScheduledSegmentNotifications().catch(e => console.error('[Cron Route Error] runScheduledSegmentNotifications:', e.message));
    cronService.runWhatsAppAutomation().catch(e => console.error('[Cron Route Error] runWhatsAppAutomation:', e.message));

    return res.status(200).json({
      success: true,
      message: 'Background cron tasks triggered successfully'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
