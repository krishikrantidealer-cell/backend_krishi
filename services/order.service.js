const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const couponService = require('./coupon.service');

class OrderService {
  async createOrderFromCart(userId, paymentMethod = 'Online', shippingAddress = null, paymentData = {}) {
    // 0. Secure Signature Verification (Prevents Fraud)
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (
      (paymentMethod === 'Online' || paymentMethod === 'Partial') &&
      keySecret &&
      !keySecret.includes('YOUR_RAZORPAY_KEY_SECRET') &&
      paymentData.razorpayOrderId &&
      paymentData.razorpayPaymentId &&
      paymentData.razorpaySignature
    ) {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(paymentData.razorpayOrderId + '|' + paymentData.razorpayPaymentId)
        .digest('hex');
      if (expectedSignature !== paymentData.razorpaySignature) {
        throw new Error('Security Alert: Razorpay signature verification failed. Payment is not authentic!');
      }
    }

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
      paymentMethod,
      paymentStatus: paymentMethod === 'Online'
        ? 'Paid'
        : (paymentMethod === 'Partial' ? 'Partially Paid' : 'Pending'),
      razorpayPaymentId: paymentData.razorpayPaymentId || null,
      advanceAmount: paymentData.advanceAmount || 0,
      remainingAmount: paymentData.remainingAmount || 0
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

  async initializeRazorpayPayment(userId, paymentMethod = 'Online', partialPercent = null) {
    const Cart = require('../models/Cart');
    const axios = require('axios');

    // 1. Get the user's cart
    const cart = await Cart.findOne({ user: userId }).populate('items.product');

    if (!cart || cart.items.length === 0) {
      throw new Error('Your cart is empty');
    }

    // 2. Calculate final price with Coupon
    let finalAmount = cart.totalAmount;

    if (cart.appliedCoupon) {
      const couponResult = await couponService.applyCoupon(userId, cart.appliedCoupon, cart.totalAmount);
      finalAmount = couponResult.finalAmount;
    }

    // 3. Determine actual amount to pay in paise
    let amountToPay = finalAmount;
    if (paymentMethod === 'Partial' && partialPercent) {
      amountToPay = finalAmount * (partialPercent / 100);
    }

    const amountInPaise = Math.round(amountToPay * 100);

    // 4. Generate Razorpay Order via Secure API call
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret || keySecret.includes('YOUR_RAZORPAY_KEY_SECRET')) {
      // Return a structured fallback/warning order if keys are not fully configured
      return {
        id: 'mock_order_' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100),
        amount: amountInPaise,
        currency: 'INR',
        isMock: true
      };
    }

    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const response = await axios.post('https://api.razorpay.com/v1/orders', {
        amount: amountInPaise,
        currency: 'INR',
        receipt: `rcpt_ORD_${Date.now().toString().slice(-6)}`
      }, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });

      return response.data;
    } catch (err) {
      const errorMsg = err.response && err.response.data && err.response.data.error 
        ? err.response.data.error.description 
        : err.message;
      throw new Error(`Razorpay initialization failed: ${errorMsg}`);
    }
  }

  async getUserOrders(userId) {
    return await Order.find({ user: userId })
      .populate('items.product')
      .sort({ createdAt: -1 });
  }

  // --- ADMIN METHODS ---
  async getAllOrders(filters = {}) {
    const query = {};
    if (filters.status) query.orderStatus = filters.status;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
    
    return await Order.find(query)
      .populate('user', 'firstName lastName phoneNumber role kycStatus isKycComplete shopName')
      .populate('items.product')
      .sort({ createdAt: -1 });
  }

  async updateOrderStatus(orderId, status, awbNumber = null, courierName = null, trackingUrl = null) {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    order.orderStatus = status;
    if (awbNumber) order.awbNumber = awbNumber;
    if (courierName) order.courierName = courierName;
    if (trackingUrl) order.trackingUrl = trackingUrl;

    if (status === 'Processing') order.processingAt = new Date();
    else if (status === 'Shipped') order.shippedAt = new Date();
    else if (status === 'Out for Delivery') order.outForDeliveryAt = new Date();
    else if (status === 'Delivered') order.deliveredAt = new Date();
    else if (status === 'Cancelled') order.cancelledAt = new Date();
    else if (status === 'RTO') order.rtoAt = new Date();

    await order.save();

    // Trigger Notification
    const notificationService = require('./notification.service');
    notificationService.sendUtilityNotification(
      order.user,
      `Order Status Update: ${status} 📦`,
      `Your order ${order.orderId} is now ${status}.`,
      `/order_details/${order._id}`
    ).catch(err => console.error("Error sending order status notification:", err));

    return order;
  }

  async getOrderById(userId, orderId) {
    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('items.product');
    if (!order) throw new Error('Order not found');
    return order;
  }

  async syncDelhiveryTracking(userId, orderId) {
    const axios = require('axios');
    const order = await Order.findOne({ _id: orderId, user: userId });
    if (!order || !order.awbNumber) return order;

    const token = process.env.DELHIVERY_API_TOKEN;
    if (!token || token.includes('YOUR_DELHIVERY_API_TOKEN')) {
      return order;
    }

    try {
      const response = await axios.get(`https://track.delhivery.com/api/v1/packages/json/?waybill=${order.awbNumber}`, {
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const packageData = response.data && response.data.ShipmentData && response.data.ShipmentData[0] && response.data.ShipmentData[0].Shipment;
      if (packageData && packageData.Status) {
        const rawStatus = packageData.Status.Status || '';
        order.courierStatus = rawStatus;

        const previousStatus = order.orderStatus;
        const statusLower = rawStatus.toLowerCase();
        
        if (statusLower.includes('manifested') || statusLower.includes('dispatched')) {
          order.orderStatus = 'Processing';
          if (!order.processingAt) order.processingAt = new Date();
        } else if (statusLower.includes('picked up') || statusLower.includes('in transit') || statusLower.includes('arrived at hub')) {
          order.orderStatus = 'Shipped';
          if (!order.shippedAt) order.shippedAt = new Date();
        } else if (statusLower.includes('out for delivery')) {
          order.orderStatus = 'Out for Delivery';
          if (!order.outForDeliveryAt) order.outForDeliveryAt = new Date();
        } else if (statusLower.includes('delivered') && !statusLower.includes('rto')) {
          order.orderStatus = 'Delivered';
          if (!order.deliveredAt) order.deliveredAt = new Date();
        } else if (statusLower.includes('rto')) {
          order.orderStatus = 'RTO';
          if (!order.rtoAt) order.rtoAt = new Date();
        } else if (statusLower.includes('cancelled')) {
          order.orderStatus = 'Cancelled';
          if (!order.cancelledAt) order.cancelledAt = new Date();
        }

        // Trigger Notification if status has actually changed
        if (previousStatus !== order.orderStatus) {
          const notificationService = require('./notification.service');
          notificationService.sendUtilityNotification(
            userId,
            `Order Status Update: ${order.orderStatus}`,
            `Your order ${order.orderId} is now ${order.orderStatus}.`,
            `/order_details/${order._id}`
          );
        }

        await order.save();
      }
      return order;
    } catch (err) {
      console.error("Delhivery API token sync failed, maintaining current state:", err.message);
      return order;
    }
  }
}

module.exports = new OrderService();
