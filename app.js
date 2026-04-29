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

const app = express();

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: '*', // Configure this for your Flutter app domain/IP in production
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Global Rate Limiting
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/favourites', favouriteRoutes);
app.use('/api/coupons', couponRoutes);

// Health Check
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

// Root Route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Krishi Auth API' });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

module.exports = app;
