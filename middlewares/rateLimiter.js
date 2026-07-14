const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient } = require('../config/redis');

const { verifyAccessToken } = require('../utils/jwt');

const safeSendCommand = async (...args) => {
  try {
    return await redisClient.sendCommand(args);
  } catch (err) {
    console.error(`[Redis Command Error] "${args.join(' ')}" failed:`, err.message);
    // Suppress startup SCRIPT LOAD failures to prevent unhandled promise rejection crashes
    if (args[0] === 'SCRIPT' && args[1] === 'LOAD') {
      return 'dummy_sha1_hash';
    }
    throw err;
  }
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // If request is authenticated, allow a very high limit (2000 per 15 min).
    // Otherwise, allow 200 per 15 min for unauthenticated IP browsing.
    return req.userId ? 2000 : 200;
  },
  keyGenerator: (req) => {
    // 1. Try to extract bearer token and parse user ID
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      const token = req.headers.authorization.split(' ')[1];
      const decoded = verifyAccessToken(token);
      if (decoded && decoded.userId) {
        req.userId = decoded.userId; // Save userId for use in max callback
        return `user:${decoded.userId}`; // Rate limit by User ID!
      }
    }
    // 2. Fallback to IP address if unauthenticated
    return req.ip;
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: new RedisStore({
    sendCommand: safeSendCommand,
  }),
  message: {
    message: 'Too many requests, please try again after 15 minutes'
  }
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // Relaxed to 100 to support cellular CGNAT users while blocking botnets
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.body && req.body.phoneNumber === '9999999999',
  passOnStoreError: true,
  store: new RedisStore({
    sendCommand: safeSendCommand,
    prefix: 'auth_limit:',
  }),
  message: {
    message: 'Too many login attempts from this IP, please try again after an hour'
  }
});

module.exports = { apiLimiter, authLimiter };
