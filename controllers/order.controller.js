const orderService = require('../services/order.service');
const notificationService = require('../services/notification.service');

exports.createOrder = async (req, res, next) => {
  try {
    const { paymentMethod, shippingAddress, razorpayPaymentId, advanceAmount, remainingAmount } = req.body;
    const order = await orderService.createOrderFromCart(
      req.user._id,
      paymentMethod,
      shippingAddress,
      { razorpayPaymentId, advanceAmount, remainingAmount }
    );
    
    // Trigger Utility Notification Automatically
    await notificationService.sendUtilityNotification(
      req.user._id,
      "Order Confirmed! 🎉",
      `Your order #${order._id.toString().substring(0, 6)} has been placed successfully.`,
      "/dashboard" 
    );

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
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
};

exports.getOrderDetails = async (req, res, next) => {
  try {
    const order = await orderService.getOrderById(req.user._id, req.params.id);
    res.json({ success: true, order });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};
