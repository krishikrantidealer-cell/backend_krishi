const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Product = require('../models/Product');

class CouponService {
  async getActiveCoupons() {
    return await Coupon.find({ isActive: true });
  }

  async applyCoupon(userId, code, cartTotalOverride = null) {
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
    
    if (!coupon) {
      throw new Error('Invalid or expired coupon code');
    }

    // 1. Get the user's cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart || cart.items.length === 0) {
      throw new Error('Your cart is empty');
    }

    const currentTotal = cartTotalOverride !== null ? cartTotalOverride : cart.totalAmount;

    // 2. Check Minimum Purchase Amount
    if (currentTotal < coupon.minimumPurchaseAmount) {
      throw new Error(`Minimum purchase amount of ₹${coupon.minimumPurchaseAmount} required`);
    }

    // 3. Check First Order Only
    if (coupon.isFirstOrderOnly) {
      const pastOrders = await Order.countDocuments({ user: userId });
      if (pastOrders > 0) {
        throw new Error('This coupon is only valid for your first order');
      }
    }

    // 4. Calculate Discount
    let discountAmount = 0;
    let freeProductAdded = null;
    let freeProductImage = null;

    if (coupon.discountType === 'Percentage') {
      discountAmount = (currentTotal * coupon.discountValue) / 100;
    } else if (coupon.discountType === 'Absolute') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'FreeProduct' && coupon.freeProductId) {
      const freeProduct = await Product.findById(coupon.freeProductId);
      if (freeProduct) {
        freeProductAdded = freeProduct.title;
        freeProductImage = freeProduct.images && freeProduct.images.length > 0 ? freeProduct.images[0] : null;
      }
    }

    // Ensure discount doesn't exceed total amount
    if (discountAmount > currentTotal) {
      discountAmount = currentTotal;
    }

    const finalAmount = currentTotal - discountAmount;

    return {
      success: true,
      couponCode: coupon.code,
      originalTotal: currentTotal,
      discountAmount: discountAmount,
      finalAmount: finalAmount,
      freeProductAdded: freeProductAdded,
      freeProductImage: freeProductImage,
      freeProductQuantity: coupon.freeProductQuantity || 1,
      message: 'Coupon applied successfully'
    };
  }
}

module.exports = new CouponService();
