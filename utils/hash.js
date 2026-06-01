const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const hashData = async (data) => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(data, salt);
};

const compareData = async (data, hashedData) => {
  return await bcrypt.compare(data, hashedData);
};

// Fast hashing for short-lived, transient OTPs to prevent DoS CPU exhaustion
const hashOTP = async (otp) => {
  return crypto.createHash('sha256').update(otp).digest('hex');
};

const compareOTP = async (otp, hashedOTP) => {
  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  return hash === hashedOTP;
};

module.exports = { hashData, compareData, hashOTP, compareOTP };
