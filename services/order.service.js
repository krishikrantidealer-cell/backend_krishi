const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const couponService = require('./coupon.service');

class OrderService {
  async createOrderFromCart(userId, paymentMethod = 'COD', shippingAddress = null) {
    // 1. Get the user's cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');

    if (!cart || cart.items.length === 0) {
      throw new Error('Your cart is empty');
    }

    // 2. Take a snapshot of the cart items
    const orderItems = cart.items.map(item => {
      return {
        product: item.product._id,
        variantId: item.variantId,
        title: item.product.title,
        vendor: item.product.vendor,
        image: item.product.images && item.product.images.length > 0 ? item.product.images[0] : null,
        quantity: item.quantity,
        price: item.price
      };
    });

    // 3. Figure out the shipping address
    const user = await User.findById(userId);
    const address = shippingAddress || user.address;

    if (!address || !address.pincode) {
      throw new Error('Please provide a complete shipping address');
    }

    // 4. Calculate final price with Coupon
    let discountAmount = 0;
    let finalAmount = cart.totalAmount;
    let freeProductAdded = null;
    let freeProductImage = null;
    let freeProductQuantity = 1;
    let finalCouponCode = null;

    if (cart.appliedCoupon) {
      // This will throw an error if the coupon is invalid or cart doesn't meet requirements
      const couponResult = await couponService.applyCoupon(userId, cart.appliedCoupon, cart.totalAmount);
      discountAmount = couponResult.discountAmount;
      finalAmount = couponResult.finalAmount;
      freeProductAdded = couponResult.freeProductAdded;
      freeProductImage = couponResult.freeProductImage;
      freeProductQuantity = couponResult.freeProductQuantity;
      finalCouponCode = cart.appliedCoupon.toUpperCase();
    }

    // 5. Generate a unique, readable Order ID (e.g. ORD-123456)
    const orderId = 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

    // 6. Create the Order
    const order = await Order.create({
      user: userId,
      orderId,
      items: orderItems,
      totalAmount: finalAmount, // Saved final amount
      discountAmount: discountAmount,
      couponCode: finalCouponCode,
      freeItems: freeProductAdded ? [{
        name: freeProductAdded,
        imageUrl: freeProductImage,
        quantity: freeProductQuantity,
        isFree: true
      }] : [],
      shippingAddress: address,
      paymentMethod
    });

    // 7. Clear the user's cart thoroughly
    cart.items = [];
    cart.totalAmount = 0;
    cart.appliedCoupon = undefined;
    cart.discountAmount = 0;
    cart.finalAmount = 0;
    cart.freeItems = [];
    await cart.save();

    return order;
  }

  async getUserOrders(userId) {
    return await Order.find({ user: userId })
      .populate('items.product')
      .sort({ createdAt: -1 });
  }

  async getOrderById(userId, orderId) {
    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('items.product');
    if (!order) throw new Error('Order not found');
    return order;
  }
}

module.exports = new OrderService();
