const express = require('express');
const adminController = require('../controllers/admin.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

router.use(protect);

// Dashboard Analytics - Admin Only
router.get('/dashboard', authorizeRoles('admin'), adminController.getDashboardAnalytics);

// Audit Logs - Admin Only
router.get('/audit-logs', authorizeRoles('admin'), adminController.getAuditLogs);

// Estimates CRUD - Accessible by both Admin and Sales agents
router.get('/estimates', authorizeRoles('admin', 'sales'), adminController.getAllEstimates);
router.post('/estimates', authorizeRoles('admin', 'sales'), adminController.createEstimate);
router.put('/estimates/:id', authorizeRoles('admin', 'sales'), adminController.updateEstimate);
router.delete('/estimates/:id', authorizeRoles('admin', 'sales'), adminController.deleteEstimate);

module.exports = router;
