const express = require('express');
const router = express.Router();
const timelineController = require('../controllers/timeline.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

/**
 * @route   GET /api/timeline
 * @desc    Get Omnichannel Customer 360° Unified Timeline
 */
router.get('/', timelineController.getCustomerTimeline);

module.exports = router;
