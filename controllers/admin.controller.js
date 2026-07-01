const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const CheckoutSession = require('../models/CheckoutSession');
const Event = require('../models/Event');

exports.getDashboardAnalytics = async (req, res, next) => {
  try {
    const { period = 'Today' } = req.query;

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    let isTotal = false;

    if (period === 'Today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (period === '1 Week') {
      startDate.setDate(now.getDate() - 7);
    } else if (period === 'Last 1 Month' || period === 'This Month') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (period === 'Last 3 Months') {
      startDate.setMonth(now.getMonth() - 3);
    } else if (period === 'Total' || period === 'All Time') {
      isTotal = true;
    } else {
      startDate.setHours(0, 0, 0, 0); // Default Today
    }

    const dateQuery = isTotal ? {} : { createdAt: { $gte: startDate } };

    // 1. User/Dealer counts
    const totalUsers = await User.countDocuments({ role: 'user' });
    const verifiedUsers = await User.countDocuments({ role: 'user', kycStatus: 'verified' });
    const pendingKyc = await User.countDocuments({ role: 'user', kycStatus: { $in: ['pending', 'submitted'] }, isProfileComplete: true });
    const newLeads = await User.countDocuments({ role: 'user', ...dateQuery });

    // 2. Order metrics
    const totalOrders = await Order.countDocuments();
    const periodOrders = await Order.countDocuments(dateQuery);
    const pendingOrders = await Order.countDocuments({ orderStatus: 'Processing' });
    
    // Revenue calculations
    const deliveredOrders = await Order.find({ orderStatus: { $ne: 'Cancelled' } }); // Include all non-cancelled for total revenue potential
    const totalRevenue = deliveredOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    const periodDeliveredOrders = await Order.find({ ...dateQuery, orderStatus: { $ne: 'Cancelled' } });
    const periodRevenue = periodDeliveredOrders.reduce((sum, order) => sum + order.totalAmount, 0);

    // 3. Checkout Sessions (Abandoned Checkouts logic)
    // Completed sessions are real orders. Pending sessions older than 30 mins are abandoned.
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    const abandonedQuery = isTotal
      ? { status: 'Pending', createdAt: { $lt: thirtyMinsAgo } }
      : { status: 'Pending', createdAt: { $gte: startDate, $lt: thirtyMinsAgo } };

    const abandonedCheckouts = await CheckoutSession.countDocuments(abandonedQuery);

    const recoveredOrders = await CheckoutSession.countDocuments({
      orderCreated: true,
      ...dateQuery
    });

    // 4. Product metrics
    const totalProducts = await Product.countDocuments();

    // 5. Events
    const eventsCount = await Event.countDocuments(dateQuery);

    res.json({
      success: true,
      analytics: {
        users: {
          total: totalUsers,
          verified: verifiedUsers,
          pendingKyc: pendingKyc,
          newLeads: newLeads
        },
        orders: {
          total: totalOrders,
          periodTotal: periodOrders,
          pending: pendingOrders,
          totalRevenue: totalRevenue,
          periodRevenue: periodRevenue
        },
        checkouts: {
          abandoned: abandonedCheckouts,
          recovered: recoveredOrders
        },
        products: {
          total: totalProducts
        },
        events: {
          periodTotal: eventsCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
