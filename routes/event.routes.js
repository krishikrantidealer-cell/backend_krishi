const express = require('express');
const eventController = require('../controllers/event.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

// Publicly accessible ingestion endpoint for client event tracking
router.post('/', eventController.createEvent);

// Only administrators can query the dashboard live event database logs
router.get('/', protect, authorizeRoles('admin'), eventController.getEvents);

module.exports = router;
