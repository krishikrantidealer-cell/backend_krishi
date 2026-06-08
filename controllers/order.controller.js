const Order = require('../models/Order');
const orderService = require('../services/order.service');
const notificationService = require('../services/notification.service');

exports.initializePayment = async (req, res, next) => {
  try {
    const { paymentMethod, partialPercent } = req.body;
    const razorpayOrder = await orderService.initializeRazorpayPayment(
      req.user._id,
      paymentMethod,
      partialPercent
    );

    res.json({
      success: true,
      razorpayOrder
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.createOrder = async (req, res, next) => {
  try {
    const {
      paymentMethod,
      shippingAddress,
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
      advanceAmount,
      remainingAmount
    } = req.body;

    const order = await orderService.createOrderFromCart(
      req.user._id,
      paymentMethod,
      shippingAddress,
      {
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature,
        advanceAmount,
        remainingAmount
      }
    );

    // Trigger Utility Notification Automatically (Non-blocking background task)
    notificationService.sendUtilityNotification(
      req.user._id,
      "Order Confirmed! 🎉",
      `Your order #${order._id.toString().substring(0, 6)} has been placed successfully.`,
      "/dashboard"
    ).catch(err => console.error("Error sending order notification in background:", err));

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getMyOrders = async (req, res, next) => {
  try {
    const orders = await orderService.getUserOrders(req.user._id);

    // Non-blocking background sync for active orders to maintain list accuracy without API lag
    if (orders && Array.isArray(orders)) {
      orders
        .filter(o => ['Processing', 'Shipped', 'Out for Delivery'].includes(o.orderStatus))
        .forEach(o => {
          orderService.syncDelhiveryTracking(req.user._id, o._id).catch(() => {});
        });
    }

    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

exports.getOrderDetails = async (req, res, next) => {
  try {
    await orderService.syncDelhiveryTracking(req.user._id, req.params.id);

    const order = await orderService.getOrderById(req.user._id, req.params.id);
    res.json({ success: true, order });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

exports.delhiveryWebhook = async (req, res, next) => {
  try {
    const rawStatus = req.body.status || req.body.current_status || '';
    const awb = req.body.awb || req.body.awb_number;
    const orderId = req.body.order_id || req.body.orderId;

    if (!awb && !orderId) {
      return res.status(400).json({ success: false, message: "AWB or Order ID required in webhook payload" });
    }

    let order;
    if (awb) {
      order = await Order.findOne({ awbNumber: awb });
    }
    if (!order && orderId) {
      order = await Order.findOne({ orderId });
    }

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found for given tracking identifier" });
    }

    order.courierStatus = rawStatus;

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

    await order.save();

    // Optional: Trigger background notification for milestone changes
    notificationService.sendUtilityNotification(
      order.user,
      `Order Update: ${order.orderStatus} 📦`,
      `Your package tracking status is now: ${order.courierStatus || order.orderStatus}.`,
      `/order_details/${order._id}`
    ).catch(err => console.error("Error sending webhook notification in background:", err));

    res.json({ success: true, message: "Webhook processed and status synced successfully", orderStatus: order.orderStatus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.cancelOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (['Shipped', 'Out for Delivery', 'Delivered', 'RTO', 'Cancelled'].includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Order has already been dispatched or cancelled. You may refuse delivery at your doorstep."
      });
    }

    order.orderStatus = 'Cancelled';
    order.cancelledAt = new Date();
    await order.save();

    // Trigger utility notification
    notificationService.sendUtilityNotification(
      order.user,
      "Order Cancelled ❌",
      `Your order #${order._id.toString().slice(-6).toUpperCase()} has been cancelled successfully.`,
      `/order_details/${order._id}`
    ).catch(err => console.error("Error sending cancellation notification:", err));

    res.json({ success: true, message: "Order cancelled successfully", order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- ADMIN CONTROLLERS ---
exports.getAllOrders = async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      paymentStatus: req.query.paymentStatus
    };
    const orders = await orderService.getAllOrders(filters);
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminUpdateOrderStatus = async (req, res, next) => {
  try {
    const { status, awbNumber, courierName, trackingUrl } = req.body;
    const { id } = req.params;

    const allowedStatuses = ['Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'RTO'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid order status' });
    }

    const order = await orderService.updateOrderStatus(id, status, awbNumber, courierName, trackingUrl);
    res.json({ success: true, message: `Order status updated to ${status}`, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
