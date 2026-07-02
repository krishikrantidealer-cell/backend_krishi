const Order = require('../models/Order');
const orderService = require('../services/order.service');
const notificationService = require('../services/notification.service');
const auditService = require('../services/audit.service');

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

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'ORDERS_UPDATE' });
    } catch (wsErr) {
      console.error("[WS] Failed to broadcast ORDERS_UPDATE on order creation:", wsErr.message);
    }

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

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'ORDERS_UPDATE' });
    } catch (wsErr) {
      console.error("[WS] Failed to broadcast ORDERS_UPDATE on order cancellation:", wsErr.message);
    }

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
      paymentStatus: req.query.paymentStatus,
      userId: req.query.userId || req.query.user || req.query.id
    };

    console.log(`[AdminOrder] Fetching orders. Query:`, JSON.stringify(req.query), `Filters:`, JSON.stringify(filters));

    if (req.user.role === 'sales') {
      const User = require('../models/User');
      const assignedUsers = await User.find({ assignedAgent: req.user._id }).select('_id');
      const assignedUserIds = assignedUsers.map(u => u._id.toString());

      if (filters.userId) {
        if (!assignedUserIds.includes(filters.userId.toString())) {
          console.warn(`[AdminOrder] Sales agent ${req.user._id} attempted to access unauthorized userId: ${filters.userId}`);
          return res.json({ success: true, orders: [] });
        }
      } else {
        filters.users = assignedUserIds;
      }
    }
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

    const oldOrder = await Order.findById(id).lean();
    const order = await orderService.updateOrderStatus(id, status, awbNumber, courierName, trackingUrl);

    // Audit Log: Order Status Updated
    auditService.logAction({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'ORDER_STATUS_UPDATE',
      targetId: order._id,
      targetModel: 'Order',
      changes: {
        before: { status: oldOrder.orderStatus },
        after: { status: order.orderStatus }
      }
    }, req);

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'ORDERS_UPDATE' });
    } catch (wsErr) {
      console.error("[WS] Failed to broadcast ORDERS_UPDATE on admin status update:", wsErr.message);
    }

    res.json({ success: true, message: `Order status updated to ${status}`, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.sheetsWebhook = async (req, res, next) => {
  try {
    const { orderId, status, secret } = req.body;

    const expectedSecret = process.env.SHEETS_WEBHOOK_SECRET || 'default_secret_key_123';
    const clientSecret = req.headers['x-sheets-secret'] || secret || req.query.secret;

    if (clientSecret !== expectedSecret) {
      return res.status(401).json({ success: false, message: 'Unauthorized webhook request' });
    }

    if (!orderId || !status) {
      return res.status(400).json({ success: false, message: 'Missing orderId or status in payload' });
    }

    const allowedStatuses = ['Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'RTO'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid order status' });
    }

    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // If status is the same, no action needed
    if (order.orderStatus === status) {
      return res.json({ success: true, message: 'Status already matches', orderStatus: order.orderStatus });
    }

    order.orderStatus = status;
    if (status === 'Processing') order.processingAt = new Date();
    else if (status === 'Shipped') order.shippedAt = new Date();
    else if (status === 'Out for Delivery') order.outForDeliveryAt = new Date();
    else if (status === 'Delivered') order.deliveredAt = new Date();
    else if (status === 'Cancelled') order.cancelledAt = new Date();
    else if (status === 'RTO') order.rtoAt = new Date();

    await order.save();

    // Trigger Notification in background
    notificationService.sendUtilityNotification(
      order.user,
      `Order Status Update: ${status} 📦`,
      `Your order ${order.orderId} status has been updated to ${status} via Google Sheets.`,
      `/order_details/${order._id}`
    ).catch(err => console.error("Error sending order status notification:", err));

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'ORDERS_UPDATE' });
    } catch (wsErr) {
      console.error("[WS] Failed to broadcast ORDERS_UPDATE on sheets webhook:", wsErr.message);
    }

    res.json({ success: true, message: `Order ${orderId} updated to ${status} from sheet`, orderStatus: status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.adminSyncSheets = async (req, res, next) => {
  try {
    const sheetsService = require('../services/sheets.service');
    const syncRes = await sheetsService.syncAllOrdersToSheet();
    res.json({ success: true, message: 'All orders synced to Google Sheets successfully', count: syncRes.count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.razorpayWebhook = async (req, res, next) => {
  try {
    const crypto = require('crypto');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature to ensure it's from Razorpay
    if (webhookSecret && signature) {
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest('hex');

      if (signature !== digest) {
        console.error('[Razorpay Webhook] Signature verification failed');
        return res.status(400).json({ success: false, message: 'Invalid signature' });
      }
    }

    const event = req.body.event;
    const payload = req.body.payload;

    console.log(`[Razorpay Webhook] Received event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = payload.payment.entity;
      const razorpayOrderId = payment.order_id;
      const razorpayPaymentId = payment.id;

      // 1. Check if order already exists
      const existingOrder = await Order.findOne({ razorpayPaymentId });
      if (existingOrder) {
        return res.json({ success: true, message: 'Order already exists' });
      }

      // 2. Look for a CheckoutSession (100% Reliability flow)
      const CheckoutSession = require('../models/CheckoutSession');
      const session = await CheckoutSession.findOne({ razorpayOrderId });

      if (session) {
        console.log(`[Razorpay Webhook] Recovering order from CheckoutSession: ${razorpayOrderId}`);
        await orderService.confirmOrder(session, { razorpayPaymentId });
        try {
          const { broadcastToRoles } = require('../services/websocket.service');
          broadcastToRoles(['admin', 'sales'], { type: 'ORDERS_UPDATE' });
        } catch (wsErr) {
          console.error("[WS] Failed to broadcast ORDERS_UPDATE on razorpay webhook:", wsErr.message);
        }
        return res.json({ success: true, message: 'Order recovered from session' });
      }

      console.log(`[Razorpay Webhook] No session found for ${razorpayOrderId}. Manual verification might be required.`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Razorpay Webhook] Error:', error);
    res.status(500).json({ success: false });
  }
};

// ---------------------------------------------------------------------------
// Admin / Sales – Create order directly from panel (bypasses cart)
// ---------------------------------------------------------------------------
exports.adminCreateOrder = async (req, res, next) => {
  try {
    const {
      userId,
      items,
      shippingAddress,
      paymentMethod,
      paymentId,
      advanceAmount,
      totalAmount,
      discountAmount,    // Captured from frontend
      couponCode,        // Captured from frontend
      freeItems,         // Captured from frontend
      orderStatus,
      paymentStatus,
      salesCouponCode,   // NEW: optional price-override coupon code
    } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'items array is required and must not be empty' });
    }
    if (!shippingAddress) {
      return res.status(400).json({ success: false, message: 'shippingAddress is required' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ success: false, message: 'paymentMethod is required' });
    }
    if (!paymentId || paymentId.trim() === '') {
      return res.status(400).json({ success: false, message: 'paymentId (transaction reference) is required' });
    }

    // Prevent duplicate orders for the same payment reference
    // We only check if the paymentId is not a generic one like 'CASH' or 'UPI'
    const genericIds = ['CASH', 'UPI', 'BANK TRANSFER', 'OFFLINE'];
    if (!genericIds.includes(paymentId.trim().toUpperCase())) {
      const existingOrder = await Order.findOne({
        user: userId,
        razorpayPaymentId: paymentId.trim()
      });
      if (existingOrder) {
        return res.status(200).json({
          success: true,
          message: 'Order already exists for this payment reference',
          order: existingOrder
        });
      }
    }

    // -----------------------------------------------------------------------
    // Sales coupon: validate and apply price override to the matching variant
    // -----------------------------------------------------------------------
    let appliedSalesCoupon = null;
    let resolvedItems = items.map(i => ({ ...i })); // shallow-copy so we can mutate

    if (salesCouponCode) {
      const SalesAgentCoupon = require('../models/SalesAgentCoupon');
      const Product = require('../models/Product');

      const coupon = await SalesAgentCoupon.findOne({
        code: salesCouponCode.trim().toUpperCase(),
      });

      if (!coupon) {
        return res.status(400).json({ success: false, message: 'Sales coupon not found' });
      }

      // If user is a sales agent, verify they created this coupon
      if (req.user.role === 'sales' && coupon.createdBy.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'You can only apply coupons created by yourself' });
      }

      if (!coupon.isActive) {
        return res.status(400).json({ success: false, message: 'Sales coupon is inactive' });
      }
      if (coupon.isUsed) {
        return res.status(400).json({
          success: false,
          message: `Sales coupon has already been used in order ${coupon.usedInOrderId}`,
        });
      }
      if (coupon.expiresAt && new Date() > coupon.expiresAt) {
        return res.status(400).json({ success: false, message: 'Sales coupon has expired' });
      }

      // Apply overrides: loop through all target variants in the coupon
      appliedSalesCoupon = coupon;

      for (const ov of coupon.overrides) {
        const variantIdStr = ov.variantId.toString();
        
        // Find product to determine packVolume and if dealerPrice is used
        const product = await Product.findById(ov.productId);
        let packVolume = 1.0;
        let hasDealerPrice = false;
        if (product && product.variants) {
          const variant = product.variants.id(ov.variantId);
          if (variant) {
            packVolume = variant.packVolume || 1.0;
            hasDealerPrice = variant.dealerPrice != null;
          }
        }

        resolvedItems = resolvedItems.map(item => {
          if (item.variantId && item.variantId.toString() === variantIdStr) {
            const finalPrice = hasDealerPrice ? ov.overridePrice : (ov.overridePrice * packVolume);
            return { ...item, price: finalPrice };
          }
          return item;
        });
      }
    }

    // Generate a short unique orderId
    const shortId = `KD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

    // Fix: totalAmount can be 0 (if coupon covers everything)
    const computed_total = (totalAmount !== undefined && totalAmount !== null)
      ? totalAmount
      : resolvedItems.reduce((s, i) => s + (i.price * i.quantity), 0);

    const advance = paymentMethod === 'Partial' ? (advanceAmount || 0) : computed_total;
    const remaining = computed_total - advance;

    // Map FullPayment → Online (same mode, Online is the existing DB enum value)
    const dbPaymentMethod = paymentMethod === 'FullPayment' ? 'Online' : paymentMethod;

    const order = await Order.create({
      user: userId,
      orderId: shortId,
      items: resolvedItems.map(i => ({
        product: i.product,
        variantId: i.variantId,
        title: i.title || 'Product',
        vendor: i.vendor || undefined,
        technicalName: i.technicalName || undefined,
        image: i.image || undefined,
        quantity: i.quantity,
        price: i.price,
      })),
      totalAmount: computed_total,
      discountAmount: discountAmount || 0,
      couponCode: couponCode || (appliedSalesCoupon ? appliedSalesCoupon.code : undefined),
      freeItems: freeItems || [],
      shippingAddress,
      paymentMethod: dbPaymentMethod,
      razorpayPaymentId: paymentId.trim(),   // reuse this field for panel payment refs
      advanceAmount: advance,
      remainingAmount: remaining,
      orderStatus: orderStatus || 'Processing',
      paymentStatus: paymentStatus || (dbPaymentMethod === 'Online' ? 'Paid' : 'Partially Paid'),
      placedAt: new Date(),
      processingAt: new Date(),
    });

    try {
      const { broadcastToRoles } = require('../services/websocket.service');
      broadcastToRoles(['admin', 'sales'], { type: 'ORDERS_UPDATE' });
    } catch (wsErr) {
      console.error("[WS] Failed to broadcast ORDERS_UPDATE on admin order creation:", wsErr.message);
    }

    // Mark the sales coupon as used (non-blocking — don't fail the order if this errors)
    if (appliedSalesCoupon) {
      appliedSalesCoupon.isUsed = true;
      appliedSalesCoupon.usedInOrderId = shortId;
      appliedSalesCoupon.save().catch(err =>
        console.error('Failed to mark sales coupon as used:', err.message)
      );
    }

    // NEW: Sync new order to Google Sheets (fire-and-forget)
    const sheetsService = require('../services/sheets.service');
    sheetsService.appendOrder(order).catch(err =>
      console.error('[Sheets] Failed to append new admin-created order:', err.message)
    );

    // Non-blocking notification to dealer
    notificationService.sendUtilityNotification(
      userId,
      'Order Placed by Sales Agent 🎉',
      `Your order #${shortId} has been placed. Total: ₹${computed_total}.`,
      `/order_details/${order._id}`
    ).catch(err => console.error('Admin create order notification error:', err));

    res.status(201).json({ success: true, message: 'Order created successfully', order });
  } catch (error) {
    console.error('adminCreateOrder error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

