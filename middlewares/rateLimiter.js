const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient } = require('../config/redis');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  message: {
    message: 'Too many requests from this IP, please try again after 15 minutes'
  }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Relaxed to 100 to support cellular CGNAT users while blocking botnets
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.body && req.body.phoneNumber === '9999999999',
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: 'auth_limit:',
  }),
  message: {
    message: 'Too many login attempts from this IP, please try again after an hour'
  }
});

module.exports = { apiLimiter, authLimiter };
