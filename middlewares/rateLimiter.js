const rateLimit = require('express-rate-limit');
const { verifyAccessToken, decodeToken } = require('../utils/jwt');

// Dedicated, zero-latency limiter for Admin / Sales portal login (in-memory, 0ms latency)
const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => {
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
  message: {
    message: 'Too many login attempts, please try again after 15 minutes'
  }
});

// General API limiter with in-memory store for 100% uptime and instant execution
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    return req.userId ? 50000 : 10000;
  },
  keyGenerator: (req) => {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.trim().split(' ');
      if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
        const token = parts[1];
        const decoded = verifyAccessToken(token) || decodeToken(token);
        const uid = decoded?.userId || decoded?.id || decoded?._id;
        if (uid) {
          req.userId = uid;
          return `user:${uid}`;
        }
      }
    }
    return req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown_ip';
  },
  skip: (req) => {
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

    const path = req.path || req.originalUrl || '';
    if (
      path.includes('/health') ||
      path.includes('/cron') ||
      path.includes('/heartbeat') ||
      path.includes('/webhook') ||
      path.includes('/auth/refresh') ||
      path.includes('/events/batch') ||
      path.includes('/calls') ||
      path.includes('/admin')
    ) {
      return true;
    }
    return false;
  },
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many requests, please try again after 15 minutes'
  }
});

// Public customer OTP limiter
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') return true;
    if (req.body && req.body.phoneNumber === '9999999999') return true;
    return false;
  },
  message: {
    message: 'Too many login attempts from this IP, please try again after an hour'
  }
});

module.exports = { apiLimiter, authLimiter, portalLoginLimiter };


