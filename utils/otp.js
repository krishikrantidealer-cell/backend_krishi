const crypto = require('crypto');

const generateOTP = () => {
  // Generate a cryptographically secure 6-digit numeric OTP
  return crypto.randomInt(100000, 1000000).toString();
};

module.exports = { generateOTP };
