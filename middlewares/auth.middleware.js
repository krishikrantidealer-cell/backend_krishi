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
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    req.deviceId = decoded.deviceId;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};

module.exports = { protect };
