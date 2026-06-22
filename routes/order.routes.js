const express = require('express');
const orderController = require('../controllers/order.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body } = require('express-validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// Public Webhook endpoint for Delhivery / Shiprocket automated push updates
router.post('/webhook', orderController.delhiveryWebhook);

// Public Webhook endpoint for Google Sheets status updates
router.post('/webhook/sheets', orderController.sheetsWebhook);

// All subsequent order routes require authentication
router.use(protect);

// Initialize Razorpay payment (Generate secure server-side order_id)
router.post('/initialize', orderController.initializePayment);

// Create a new order from the cart
router.post(
  '/',
  [
    body('paymentMethod').optional().isIn(['Online', 'Partial']).withMessage('Invalid payment method')
  ],
  validate,
  orderController.createOrder
);

// Get list of my orders
router.get('/', orderController.getMyOrders);

// Get specific order details
router.get('/:id', orderController.getOrderDetails);

// Cancel an order (Before dispatch)
router.post('/:id/cancel', orderController.cancelOrder);

// --- ADMIN ROUTES ---
const { authorizeRoles } = require('../middlewares/auth.middleware');

// Get all orders (Admin only)
router.get('/admin/all', authorizeRoles('admin'), orderController.getAllOrders);

// Update order status (Admin only)
router.put('/admin/:id/status', authorizeRoles('admin'), orderController.adminUpdateOrderStatus);

// Force sync all orders to Google Sheets (Admin only)
router.post('/admin/sheets/sync', authorizeRoles('admin'), orderController.adminSyncSheets);

module.exports = router;
