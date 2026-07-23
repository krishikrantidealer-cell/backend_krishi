// Triggering restart
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { apiLimiter } = require('./middlewares/rateLimiter');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const productRoutes = require('./routes/product.routes');
const cartRoutes = require('./routes/cart.routes');
const orderRoutes = require('./routes/order.routes');
const favouriteRoutes = require('./routes/favourite.routes');
const couponRoutes = require('./routes/coupon.routes');
const collectionRoutes = require('./routes/collection.routes');
const adminRoutes = require('./routes/admin.routes');
const salesCouponRoutes = require('./routes/salesCoupon.routes');
const eventRoutes = require('./routes/event.routes');
const cronRoutes = require('./routes/cron.routes');
const webhookRoutes = require('./routes/webhook.routes');
const conversationRoutes = require('./routes/conversation.routes');
const retargetingRoutes = require('./routes/retargeting.routes');
const callRoutes = require('./routes/call.routes');

const app = express();
const zlib = require('zlib');

// Trust proxy for correct IP detection behind Render/Load Balancers
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: '*', // Configure this for your Flutter app domain/IP in production
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  credentials: true
}));

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/favourites', favouriteRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sales-coupons', salesCouponRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api', webhookRoutes);
app.use('/api', conversationRoutes);
app.use('/api/retargeting', retargetingRoutes);
app.use('/api/calls', callRoutes);

// 404 Handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.method} ${req.originalUrl}`
  });
});

app.get('/health', async (req, res) => {
  const { redisClient } = require('./config/redis');
  let redisStatus = 'disconnected';
  try {
    const ping = await redisClient.ping();
    if (ping === 'PONG') redisStatus = 'connected';
  } catch (err) {
    redisStatus = 'error';
  }

  res.json({
    status: 'ok',
    timestamp: new Date(),
    redis: redisStatus,
    mongodb: require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Krishi Auth API' });
});

app.use((err, req, res, next) => {
  // Handle Multer errors (file too large, etc.) as 400 Bad Request
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`,
      code: err.code
    });
  }

  // Handle specific validation errors or user errors
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  // Log critical errors in development
  if (process.env.NODE_ENV !== 'production' || statusCode === 500) {
    console.error(`[Error] ${req.method} ${req.url}:`, err.message);
    if (err.stack) console.error(err.stack);
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

module.exports = app;
