const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');
const CheckoutSession = require('../models/CheckoutSession');
const couponService = require('./coupon.service');
const sheetsService = require('./sheets.service');
const whatsappService = require('./whatsapp.service');

class OrderService {
  async confirmOrder(session, paymentData, overrideAddress = null) {
    if (session.orderCreated) {
      return await Order.findById(session.createdOrderId).populate('items.product');
    }

    console.log(`[OrderService] Confirming order for Session: ${session.razorpayOrderId}`);

    // Create the Order from session data
    const orderId = 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

    const order = await Order.create({
      user: session.user,
      orderId,
      items: session.items,
      totalAmount: session.totalAmount,
      discountAmount: session.discountAmount,
      couponCode: session.couponCode,
      shippingAddress: overrideAddress || session.shippingAddress,
      paymentMethod: session.paymentMethod,
      paymentStatus: session.paymentMethod === 'Online' ? 'Paid' : 'Partially Paid',
      razorpayPaymentId: paymentData.razorpayPaymentId,
      advanceAmount: session.advanceAmount,
      remainingAmount: session.remainingAmount
    });

    // Mark session as completed
    session.orderCreated = true;
    session.createdOrderId = order._id;
    session.status = 'Completed';
    await session.save();

    // Clear cart (if it's still full)
    const cart = await Cart.findOne({ user: session.user });
    if (cart) {
      cart.items = [];
      cart.totalAmount = 0;
      cart.appliedCoupon = undefined;
      await cart.save();
    }

    // Sync & Notify
    sheetsService.appendOrder(order).catch(err => console.error('[Sheets] confirmOrder error:', err.message));

    User.findById(session.user).then(user => {
      if (user) {
        whatsappService.notifyNewOrder(order, user);
        whatsappService.notifyOrderSuccessToUser(order, user);
      }
    }).catch(() => {});

    return order;
  }

  async createOrderFromCart(userId, paymentMethod = 'Online', shippingAddress = null, paymentData = {}) {
    // 0. Check if a CheckoutSession exists for this Razorpay Order (100% Reliability flow)
    if (paymentData.razorpayOrderId) {
      const session = await CheckoutSession.findOne({ razorpayOrderId: paymentData.razorpayOrderId });
      if (session) {
        return await this.confirmOrder(session, paymentData, shippingAddress);
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.isKycComplete) {
      throw new Error('KYC verification is pending. Please wait for administrator approval to place orders.');
    }

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
      // Check for duplicate order with this paymentId first (Idempotency)
      const existingOrder = await Order.findOne({ razorpayPaymentId: paymentData.razorpayPaymentId });
      if (existingOrder) {
        return existingOrder;
      }

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
      let variantName = 'Standard';
      if (item.product && item.product.variants) {
        const variant = item.product.variants.id(item.variantId);
        if (variant) {
          variantName = variant.size || 'Standard';
        }
      }
      return {
        product: item.product._id,
        variantId: item.variantId,
        title: item.product.title,
        vendor: item.product.vendor,
        image: item.product.images && item.product.images.length > 0 ? item.product.images[0] : null,
        quantity: item.quantity,
        price: item.price,
        variant: variantName
      };
    });

    // 3. Figure out the shipping address
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
      }] : (cart.freeItems && cart.freeItems.length > 0 ? cart.freeItems.map(f => ({
        name: f.name,
        imageUrl: f.imageUrl || null,
        quantity: f.quantity || 1,
        isFree: true
      })) : []),
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

    // 8. Sync new order to Google Sheets (fire-and-forget)
    sheetsService.appendOrder(order).catch(err =>
      console.error('[Sheets] Failed to append new order:', err.message)
    );

    // 9. Send WhatsApp notification to admin & user (fire-and-forget)
    whatsappService.notifyNewOrder(order, user).catch(err =>
      console.error('[WhatsApp] Failed to send admin notification:', err.message)
    );
    whatsappService.notifyOrderSuccessToUser(order, user).catch(err =>
      console.error('[WhatsApp] Failed to send user notification:', err.message)
    );

    return order;
  }

  async initializeRazorpayPayment(userId, paymentMethod = 'Online', partialPercent = null) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (!user.isKycComplete) {
      throw new Error('KYC verification is pending. Please wait for administrator approval to place orders.');
    }

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

      const razorpayOrder = response.data;

      // --- SAVE CHECKOUT SESSION (100% RELIABILITY ENGINE) ---
      try {
        const orderItems = cart.items.map(item => {
          let variantName = 'Standard';
          if (item.product && item.product.variants) {
            const variant = item.product.variants.id(item.variantId);
            if (variant) {
              variantName = variant.size || 'Standard';
            }
          }
          return {
            product: item.product._id,
            variantId: item.variantId,
            title: item.product.title,
            vendor: item.product.vendor,
            image: item.product.images && item.product.images.length > 0 ? item.product.images[0] : null,
            quantity: item.quantity,
            price: item.price,
            variant: variantName
          };
        });

        await CheckoutSession.create({
          user: userId,
          razorpayOrderId: razorpayOrder.id,
          items: orderItems,
          totalAmount: finalAmount,
          discountAmount: cart.discountAmount || 0,
          couponCode: cart.appliedCoupon,
          shippingAddress: user.address, // Capture current address
          paymentMethod: paymentMethod,
          advanceAmount: amountToPay,
          remainingAmount: finalAmount - amountToPay
        });
        console.log(`[OrderService] Created CheckoutSession for Razorpay Order: ${razorpayOrder.id}`);
      } catch (sessionErr) {
        console.error(`[OrderService] Failed to create CheckoutSession:`, sessionErr.message);
        // We don't throw here to avoid blocking the payment UI,
        // but the "safety net" will be missing for this transaction.
      }

      return razorpayOrder;
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

    if (filters.startDate || filters.endDate) {
      query.placedAt = {};
      if (filters.startDate) query.placedAt.$gte = new Date(filters.startDate);
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query.placedAt.$lte = end;
      }
    }

    const targetUser = filters.userId || filters.user;

    if (targetUser) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(targetUser)) {
        query.user = new mongoose.Types.ObjectId(targetUser);
      } else {
        query.user = targetUser;
      }
    } else if (filters.users) {
      // If users array is provided (even if empty), we MUST filter by it.
      // An empty array means the sales agent has no assigned users, so they should see no orders.
      query.user = { $in: filters.users };
    }
    
    console.log(`[OrderService] Final MongoDB Query:`, JSON.stringify(query));

    return await Order.find(query)
      .populate({
        path: 'user',
        select: 'firstName lastName phoneNumber role kycStatus isKycComplete shopName assignedAgent',
        populate: {
          path: 'assignedAgent',
          select: 'firstName lastName phoneNumber'
        }
      })
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

    // Sync updated order status to Google Sheets (fire-and-forget)
    sheetsService.updateOrderRow(order).catch(err =>
      console.error('[Sheets] Failed to update order row:', err.message)
    );

    // Send WhatsApp notification to admin (fire-and-forget)
    whatsappService.notifyOrderStatusUpdate(order).catch(err =>
      console.error('[WhatsApp] Failed to send status update notification:', err.message)
    );

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

        // Trigger Notification + WS push if status has actually changed
        if (previousStatus !== order.orderStatus) {
          const notificationService = require('./notification.service');
          notificationService.sendUtilityNotification(
            userId,
            `Order Status Update: ${order.orderStatus}`,
            `Your order ${order.orderId} is now ${order.orderStatus}.`,
            `/order_details/${order._id}`
          );

          // Push real-time WebSocket update to the buyer (if their app is open)
          try {
            const { sendToUser } = require('./websocket.service');
            sendToUser(userId.toString(), {
              type: 'ORDER_STATUS_UPDATE',
              orderId: order._id.toString(),
              orderStatus: order.orderStatus,
              courierStatus: order.courierStatus || null
            });
          } catch (wsErr) {
            console.error('[WS] Failed to push ORDER_STATUS_UPDATE from Delhivery sync:', wsErr.message);
          }
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
