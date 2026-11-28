const express = require('express');
const router = express.Router();
const attributionController = require('../controllers/attribution.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

router.use(protect);

// App install attribution hook (authenticated app user)
router.post('/app-install', attributionController.recordAppInstallReferrer);

// Attribution & ROAS reporting (Admin & Marketing)
router.get('/report', authorizeRoles('admin', 'marketing'), attributionController.getAttributionReport);
router.post('/sync-spend', authorizeRoles('admin', 'marketing'), attributionController.syncAdSpend);
router.post('/backfill', authorizeRoles('admin', 'marketing'), attributionController.backfillTouches);
router.post('/spend', authorizeRoles('admin', 'marketing'), attributionController.upsertAdSpend);
router.get('/leads/:userId/timeline', authorizeRoles('admin', 'sales', 'marketing'), attributionController.getLeadAttributionTimeline);
router.post('/leads/:userId/stage', authorizeRoles('admin', 'sales'), attributionController.updateLeadStage);

module.exports = router;
