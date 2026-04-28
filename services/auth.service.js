const redisClient = require('../config/redis');
const smsService = require('./sms.service');
const { generateOTP } = require('../utils/otp');
const { hashData, compareData } = require('../utils/hash');

const OTP_EXPIRY = 300; // 5 minutes in seconds
const MAX_VERIFICATION_ATTEMPTS = 3;

class AuthService {
  async sendOTP(phoneNumber) {
    const otp = generateOTP();
    const hashedOTP = await hashData(otp);

    // 1. Store hashed OTP and attempt count in Redis
    const otpKey = `otp:${phoneNumber}`;
    await redisClient.set(otpKey, JSON.stringify({
      hashedOTP,
      attempts: 0
    }), {
      EX: OTP_EXPIRY
    });

    // 2. Send SMS via SmsService (which handles Redis-based rate limiting internally)
    await smsService.sendOTP(phoneNumber, otp);

    return otp; // Return for development/testing
  }

  async verifyOTP(phoneNumber, otp) {
    const otpKey = `otp:${phoneNumber}`;
    const otpDataRaw = await redisClient.get(otpKey);

    if (!otpDataRaw) {
      throw new Error('OTP expired or not found.');
    }

    const otpData = JSON.parse(otpDataRaw);

    if (otpData.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      await redisClient.del(otpKey);
      throw new Error('Maximum verification attempts reached. Please request a new OTP.');
    }

    const isMatch = await compareData(otp, otpData.hashedOTP);

    if (!isMatch) {
      otpData.attempts += 1;
      await redisClient.set(otpKey, JSON.stringify(otpData), {
        KEEPTTL: true
      });
      throw new Error('Invalid OTP.');
    }

    // OTP is correct, delete it (single-use)
    await redisClient.del(otpKey);
    return true;
  }
}

module.exports = new AuthService();
