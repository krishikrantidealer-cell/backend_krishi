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

// Estimates CRUD
router.get('/estimates', adminController.getAllEstimates);
router.post('/estimates', adminController.createEstimate);
router.put('/estimates/:id', adminController.updateEstimate);
router.delete('/estimates/:id', adminController.deleteEstimate);

module.exports = router;
