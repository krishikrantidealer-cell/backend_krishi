const express = require('express');
const eventController = require('../controllers/event.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

// --- Ingestion Endpoints ---
// Legacy support for single event
router.post('/', eventController.createEvent);

// Gold Standard: Batch Ingestion
router.post('/batch', eventController.ingestBatch);

// Real-time Heartbeat (High frequency, Redis only)
router.post('/heartbeat', eventController.handleHeartbeat);

// --- Dashboard Queries (Admin Only) ---
// Fetch historical logs
router.get('/', protect, authorizeRoles('admin'), eventController.getEvents);

// Fetch real-time active users presence
router.get('/realtime', protect, authorizeRoles('admin'), eventController.getActiveUsers);

// Fetch conversion funnel analytics
router.get('/funnel', protect, authorizeRoles('admin'), eventController.getFunnelData);

// Fetch overall summary metrics (high priority, failed payments, abandoned carts)
router.get('/summary-metrics', protect, authorizeRoles('admin'), eventController.getSummaryMetrics);

module.exports = router;
