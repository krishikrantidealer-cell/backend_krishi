const couponService = require('../services/coupon.service');
const auditService = require('../services/audit.service');

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

    // Audit Log: Coupon Created
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'COUPON_CREATED',
      targetId: coupon._id,
      targetModel: 'Coupon',
      changes: { after: coupon }
    }, req);
    res.status(201).json({ success: true, message: 'Coupon created', coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateCoupon = async (req, res, next) => {
  try {
    const coupon = await couponService.updateCoupon(req.params.id, req.body);

    // Audit Log: Coupon Updated
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'COUPON_UPDATED',
      targetId: req.params.id,
      targetModel: 'Coupon',
      changes: { after: coupon }
    }, req);
    res.json({ success: true, message: 'Coupon updated', coupon });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteCoupon = async (req, res, next) => {
  try {
    await couponService.deleteCoupon(req.params.id);

    // Audit Log: Coupon Deleted
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'COUPON_DELETED',
      targetId: req.params.id,
      targetModel: 'Coupon'
    }, req);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
