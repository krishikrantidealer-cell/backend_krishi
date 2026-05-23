const couponService = require('../services/coupon.service');

exports.getActiveCoupons = async (req, res, next) => {
  try {
    const coupons = await couponService.getActiveCoupons();
    res.json({
      success: true,
      coupons
    });
  } catch (error) {
    next(error);
  }
};

// --- ADMIN CONTROLLERS ---
exports.getAllCoupons = async (req, res, next) => {
  try {
    const coupons = await couponService.getAllCoupons();
    res.json({ success: true, coupons });
  } catch (error) {
    next(error);
  }
};

exports.createCoupon = async (req, res, next) => {
  try {
    const coupon = await couponService.createCoupon(req.body);
    res.status(201).json({ success: true, message: 'Coupon created', coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateCoupon = async (req, res, next) => {
  try {
    const coupon = await couponService.updateCoupon(req.params.id, req.body);
    res.json({ success: true, message: 'Coupon updated', coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteCoupon = async (req, res, next) => {
  try {
    await couponService.deleteCoupon(req.params.id);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
