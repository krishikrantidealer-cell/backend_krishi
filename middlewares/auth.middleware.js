const { verifyAccessToken } = require('../utils/jwt');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  // Check Redis blacklist
  const tokenService = require('../services/token.service');
  const isBlacklisted = await tokenService.isTokenBlacklisted(token);
  
  if (isBlacklisted) {
    return res.status(401).json({ message: 'Token is no longer valid (logged out)' });
  }

  const decoded = verifyAccessToken(token);

  if (!decoded) {
    return res.status(401).json({ message: 'Not authorized, token invalid or expired' });
  }

  try {
    const user = await User.findById(decoded.userId).select('-password');
    if (!user || user.isDeleted) {
      return res.status(401).json({ message: 'User not found' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Your account has been blocked. Access denied.' });
    }

    req.user = user;
    req.deviceId = decoded.deviceId;

    // Restrict the guest user (9999999999) to read-only requests, except for logout
    const isWriteRequest = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (isWriteRequest && user.phoneNumber === '9999999999') {
      const isLogout = req.path && req.path.includes('logout');
      if (!isLogout) {
        return res.status(403).json({
          success: false,
          message: 'Guest account is restricted to read-only access. Please log in with your own phone number.'
        });
      }
    }

    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role (${req.user ? req.user.role : 'unknown'}) is not allowed to access this resource`
      });
    }
    next();
  };
};

const MYOPERATOR_AUTHORIZED_EMAILS = [
  'admin@krishikranti.com',
  'ebsale08@gmail.com',
  'essentialsale14@gmail.com',
  'essentialsale8@gmail.com',
  'sales3.essential@gmail.com',
  'essentialbiosciences12@gmail.com',
  'sales6.essential@gmail.com'
];

const authorizeMyOperatorAgent = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }
  // Dynamic MongoDB boolean check or admin role
  if (req.user.role === 'admin' || req.user.myoperator === true) {
    return next();
  }
  const userEmail = (req.user.email || '').trim().toLowerCase();
  if (MYOPERATOR_AUTHORIZED_EMAILS.includes(userEmail)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Access denied. You do not have permissions to access WhatsApp CRM or Telephony features.'
  });
};

module.exports = {
  protect,
  authorizeRoles,
  authorizeMyOperatorAgent,
  MYOPERATOR_AUTHORIZED_EMAILS
};
