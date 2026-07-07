const express = require('express');
const adminController = require('../controllers/admin.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);
router.use(authorizeRoles('admin'));

// Dashboard Analytics
router.get('/dashboard', adminController.getDashboardAnalytics);

// Audit Logs
router.get('/audit-logs', adminController.getAuditLogs);

module.exports = router;
