const express = require('express');
const couponController = require('../controllers/coupon.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body } = require('express-validator');
const validate = require('../middlewares/validate');

const router = express.Router();

// Get active coupons (Public or logged in)
router.get('/active', couponController.getActiveCoupons);

module.exports = router;
