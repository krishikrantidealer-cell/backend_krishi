const jwt = require('jsonwebtoken');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'krishi_kranti_access_secret_2026_xYz987';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'krishi_kranti_refresh_secret_2026_xYz987';

const generateAccessToken = (payload) => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: '7d',
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: '30d',
  });
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, JWT_ACCESS_SECRET);
  } catch (error) {
    return null;
  }
};

const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  decodeToken,
  verifyRefreshToken,
};

