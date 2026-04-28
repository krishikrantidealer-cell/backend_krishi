const Order = require('../models/Order');
const Cart = require('../models/Cart');
const User = require('../models/User');

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

    // 4. Generate a unique, readable Order ID (e.g. ORD-123456)
    const orderId = 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);

    // 5. Create the Order
    const order = await Order.create({
      user: userId,
      orderId,
      items: orderItems,
      totalAmount: cart.totalAmount,
      shippingAddress: address,
      paymentMethod
    });

    // 6. Clear the user's cart since they just bought everything
    cart.items = [];
    cart.totalAmount = 0;
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
