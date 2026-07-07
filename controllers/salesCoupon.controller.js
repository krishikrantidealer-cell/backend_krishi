const SalesAgentCoupon = require('../models/SalesAgentCoupon');
const auditService = require('../services/audit.service');

exports.createSalesCoupon = async (req, res, next) => {
  try {
    const { overrides, expiresAt } = req.body;

    if (!overrides || !Array.isArray(overrides) || overrides.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one product override is required' });
    }

    // Generate a unique code (e.g. SA-XXXX)
    let code;
    let isUnique = false;
    while (!isUnique) {
      const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `SA-${randomStr}`;
      const existing = await SalesAgentCoupon.findOne({ code });
      if (!existing) isUnique = true;
    }

    const coupon = await SalesAgentCoupon.create({
      code,
      createdBy: req.user._id,
      overrides,
      expiresAt,
      isActive: true,
      isUsed: false
    });

    // Audit Log: Sales Coupon Created
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'SALES_COUPON_CREATED',
      targetId: coupon._id,
      targetModel: 'SalesAgentCoupon',
      changes: { after: coupon }
    }, req);

    res.status(201).json({ success: true, message: 'Sales coupon created', coupon });
  } catch (error) {
    next(error);
  }
};

exports.getMySalesCoupons = async (req, res, next) => {
  try {
    const coupons = await SalesAgentCoupon.find({ createdBy: req.user._id, isUsed: false, isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, coupons });
  } catch (error) {
    next(error);
  }
};

exports.validateSalesCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }

    const coupon = await SalesAgentCoupon.findOne({ code: code.toUpperCase(), isActive: true });

    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Invalid coupon code' });
    }
    if (coupon.isUsed) {
      return res.status(400).json({ success: false, message: 'Coupon already used' });
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return res.status(400).json({ success: false, message: 'Coupon expired' });
    }

    res.json({ success: true, coupon });
  } catch (error) {
    next(error);
  }
};

exports.getAllSalesCoupons = async (req, res, next) => {
  try {
    const coupons = await SalesAgentCoupon.find().populate('createdBy', 'firstName lastName').sort({ createdAt: -1 });
    res.json({ success: true, coupons });
  } catch (error) {
    next(error);
  }
};

exports.deleteSalesCoupon = async (req, res, next) => {
  try {
    const coupon = await SalesAgentCoupon.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    // Only creator or admin can delete
    if (coupon.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const oldCoupon = JSON.parse(JSON.stringify(coupon));
    await SalesAgentCoupon.findByIdAndDelete(req.params.id);

    // Audit Log: Sales Coupon Deleted
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'SALES_COUPON_DELETED',
      targetId: req.params.id,
      targetModel: 'SalesAgentCoupon',
      changes: { before: oldCoupon }
    }, req);
    res.json({ success: true, message: 'Coupon deleted' });
  } catch (error) {
    next(error);
  }
};
