const express = require('express');
const orderController = require('../controllers/order.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body } = require('express-validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// All order routes require authentication
router.use(protect);

// Create a new order from the cart
router.post(
  '/',
  [
    body('paymentMethod').optional().isIn(['COD', 'Online']).withMessage('Invalid payment method')
  ],
  validate,
  orderController.createOrder
);

// Get list of my orders
router.get('/', orderController.getMyOrders);

// Get specific order details
router.get('/:id', orderController.getOrderDetails);

module.exports = router;
