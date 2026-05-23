const express = require('express');
const couponController = require('../controllers/coupon.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body } = require('express-validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// Get active coupons (Public or logged in)
router.get('/active', couponController.getActiveCoupons);

// --- ADMIN ROUTES ---
const { authorizeRoles } = require('../middlewares/auth.middleware');

// Get all coupons (Admin)
router.get('/admin', protect, authorizeRoles('admin'), couponController.getAllCoupons);

// Create coupon (Admin)
router.post('/admin', protect, authorizeRoles('admin'), couponController.createCoupon);

// Update coupon (Admin)
router.put('/admin/:id', protect, authorizeRoles('admin'), couponController.updateCoupon);

// Delete coupon (Admin)
router.delete('/admin/:id', protect, authorizeRoles('admin'), couponController.deleteCoupon);

module.exports = router;
