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

const app = express();
const zlib = require('zlib');

// Trust proxy for correct IP detection behind Render/Load Balancers
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) {
    return next();
  }

  const chunks = [];
  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function (chunk, ...args) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };

  res.end = function (chunk, encoding, ...args) {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (chunks.length === 0) {
      res.write = originalWrite;
      res.end = originalEnd;
      return originalEnd.call(this, chunk, encoding, ...args);
    }
    const body = Buffer.concat(chunks);
    if (body.length < 1024) {
      res.write = originalWrite;
      res.end = originalEnd;
      return originalEnd.call(this, body, encoding, ...args);
    }
    zlib.gzip(body, (err, compressed) => {
      if (err) {
        res.write = originalWrite;
        res.end = originalEnd;
        return originalEnd.call(this, body, encoding, ...args);
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', compressed.length);
      res.write = originalWrite;
      res.end = originalEnd;
      originalEnd.call(this, compressed, ...args);
    });
  };

  next();
});

app.use(helmet());
app.use(cors({
  origin: '*', // Configure this for your Flutter app domain/IP in production
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
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
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

module.exports = app;
