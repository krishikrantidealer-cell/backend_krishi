const express = require('express');
const salesCouponController = require('../controllers/salesCoupon.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

router.post('/', protect, authorizeRoles('sales', 'admin'), salesCouponController.createSalesCoupon);
router.get('/mine', protect, authorizeRoles('sales', 'admin'), salesCouponController.getMySalesCoupons);
router.post('/validate', protect, authorizeRoles('sales', 'admin'), salesCouponController.validateSalesCoupon);
router.get('/admin/all', protect, authorizeRoles('admin'), salesCouponController.getAllSalesCoupons);
router.delete('/:id', protect, authorizeRoles('sales', 'admin'), salesCouponController.deleteSalesCoupon);

module.exports = router;
