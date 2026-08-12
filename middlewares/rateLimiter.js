const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient } = require('../config/redis');

const { verifyAccessToken, decodeToken } = require('../utils/jwt');

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
    // If request is authenticated (staff, admin, dealer, or customer), allow 50,000 requests per 15 min.
    // Otherwise, allow 10,000 requests per 15 min for unauthenticated browsing to support shared office/CGNAT IPs.
    return req.userId ? 50000 : 10000;
  },
  keyGenerator: (req) => {
    // 1. Try to extract bearer token and parse user ID
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.trim().split(' ');
      if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
        const token = parts[1];
        // Verify token or decode if recently expired to retain user-based rate limit bucket during refresh
        const decoded = verifyAccessToken(token) || decodeToken(token);
        const uid = decoded?.userId || decoded?.id || decoded?._id;
        if (uid) {
          req.userId = uid; // Save userId for use in max callback
          return `user:${uid}`; // Rate limit by User ID!
        }
      }
    }
    // 2. Fallback to IP address if unauthenticated
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown_ip';
  },
  skip: (req) => {
    // Skip rate limiting in development mode or on local addresses
    if (process.env.NODE_ENV !== 'production' || process.env.NODE_ENV === 'development') return true;

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    if (
      ip.includes('127.0.0.1') ||
      ip.includes('::1') ||
      ip.includes('localhost') ||
      req.hostname === 'localhost' ||
      req.hostname === '127.0.0.1'
    ) {
      return true;
    }

    // Skip high-frequency heartbeat, health, cron, and token refresh endpoints
    const path = req.path || req.originalUrl || '';
    if (
      path.includes('/health') ||
      path.includes('/cron') ||
      path.includes('/heartbeat') ||
      path.includes('/webhook') ||
      path.includes('/auth/refresh') ||
      path.includes('/events/batch')
    ) {
      return true;
    }
    return false;
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

// Dedicated limiter for Admin / Sales portal login (keyed by email + IP)
const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by email to isolate individual accounts and prevent shared IP blocks
    if (req.body && req.body.email) {
      const email = req.body.email.toString().trim().toLowerCase();
      const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip';
      return `portal_login:${email}:${ip}`;
    }
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown_ip';
  },
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') return true;
    return false;
  },
  passOnStoreError: true,
  store: new RedisStore({
    sendCommand: safeSendCommand,
    prefix: 'portal_auth_limit:',
  }),
  message: {
    message: 'Too many login attempts, please try again after 15 minutes'
  }
});

// Public customer OTP limiter
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // Relaxed to 1000 to support cellular CGNAT
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') return true;
    if (req.body && req.body.phoneNumber === '9999999999') return true;
    return false;
  },
  passOnStoreError: true,
  store: new RedisStore({
    sendCommand: safeSendCommand,
    prefix: 'auth_limit:',
  }),
  message: {
    message: 'Too many login attempts from this IP, please try again after an hour'
  }
});

module.exports = { apiLimiter, authLimiter, portalLoginLimiter };


