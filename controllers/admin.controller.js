const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');

exports.getDashboardAnalytics = async (req, res, next) => {
  try {
    // 1. User/Dealer counts
    const totalUsers = await User.countDocuments({ role: 'user' });
    const verifiedUsers = await User.countDocuments({ role: 'user', kycStatus: 'verified' });
    const pendingKyc = await User.countDocuments({ role: 'user', kycStatus: 'pending', isProfileComplete: true });

    // 2. Order metrics
    const totalOrders = await Order.countDocuments();
    const pendingOrders = await Order.countDocuments({ orderStatus: 'Pending' });
    
    // Revenue calculations
    const deliveredOrders = await Order.find({ orderStatus: 'Delivered' });
    const totalRevenue = deliveredOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // 3. Product metrics
    const totalProducts = await Product.countDocuments();

    res.json({
      success: true,
      analytics: {
        users: {
          total: totalUsers,
          verified: verifiedUsers,
          pendingKyc: pendingKyc
        },
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          totalRevenue: totalRevenue
        },
        products: {
          total: totalProducts
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
