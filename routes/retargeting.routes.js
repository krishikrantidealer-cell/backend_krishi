const express = require('express');
const router = express.Router();
const controller = require('../controllers/retargeting.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

router.use(protect);
router.use(authorizeRoles('admin', 'sales', 'marketing'));

router.get('/cohorts', controller.getRetargetingCohorts);
router.post('/broadcast', controller.sendRetargetingBroadcast);

module.exports = router;
