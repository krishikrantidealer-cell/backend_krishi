const express = require('express');
const cartController = require('../controllers/cart.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body, param } = require('express-validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// All cart routes require the user to be logged in
router.use(protect);

// Get current user's cart
router.get('/', cartController.getCart);

// Add item to cart
router.post(
  '/items',
  [
    body('productId').isMongoId().withMessage('Valid product ID is required'),
    body().custom((value) => {
      if (!value.variantId && (!value.variants || !Array.isArray(value.variants) || value.variants.length === 0)) {
        throw new Error('Either variantId or a non-empty variants array is required');
      }
      return true;
    })
  ],
  validate,
  cartController.addItem
);

// Update item quantity
router.patch(
  '/items/:itemId',
  [
    param('itemId').isMongoId().withMessage('Valid item ID is required'),
    body('quantity').isInt({ min: 0 }).withMessage('Quantity must be 0 or more')
  ],
  validate,
  cartController.updateQuantity
);

// Remove item from cart
router.delete(
  '/items/:itemId',
  [
    param('itemId').isMongoId().withMessage('Valid item ID is required')
  ],
  validate,
  cartController.removeItem
);

// Clear entire cart
router.delete('/', cartController.clearCart);

// Apply coupon to cart
router.post(
  '/coupon',
  [
    body('code').trim().notEmpty().withMessage('Coupon code is required')
  ],
  validate,
  cartController.applyCoupon
);

// Remove coupon from cart
router.delete('/coupon', cartController.removeCoupon);

module.exports = router;
