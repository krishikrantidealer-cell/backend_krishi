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


