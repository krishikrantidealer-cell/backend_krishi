const { redisClient } = require('../config/redis');
const smsService = require('./sms.service');
const { generateOTP } = require('../utils/otp');
const { hashData, compareData, hashOTP, compareOTP } = require('../utils/hash');

const OTP_EXPIRY = 300; // 5 minutes in seconds
const MAX_VERIFICATION_ATTEMPTS = 3;

class AuthService {
  async sendOTP(phoneNumber) {
    // For the demo/test number, always use a fixed OTP so reviewers can log in reliably.
    const TEST_PHONE = '9999999999';
    const TEST_OTP = '123456';
    const otp = phoneNumber === TEST_PHONE ? TEST_OTP : generateOTP();
    const hashedOTP = await hashOTP(otp);

    // 1. Store hashed OTP and attempt count in Redis
    const otpKey = `otp:${phoneNumber}`;
    try {
      await redisClient.set(otpKey, JSON.stringify({
        hashedOTP,
        attempts: 0
      }), {
        EX: OTP_EXPIRY
      });
    } catch (redisErr) {
      console.error('[Redis Error] Failed to store OTP in Redis:', redisErr.message);
      throw new Error('Verification service is temporarily unavailable. Please try again later.');
    }

    // 2. Send SMS via SmsService (which handles Redis-based rate limiting internally)

    await smsService.sendOTP(phoneNumber, otp);

    return otp; // Return for development/testing
  }

  async verifyOTP(phoneNumber, otp) {
    const otpKey = `otp:${phoneNumber}`;
    let otpDataRaw;
    try {
      otpDataRaw = await redisClient.get(otpKey);
    } catch (redisErr) {
      console.error('[Redis Error] Failed to get OTP from Redis:', redisErr.message);
      throw new Error('Verification service is temporarily unavailable. Please try again later.');
    }

    if (!otpDataRaw) {
      throw new Error('OTP expired or not found.');
    }

    const otpData = JSON.parse(otpDataRaw);
    const masterOtp = process.env.MASTER_OTP;
    const isProduction = process.env.NODE_ENV === 'production';

    // Allow Master OTP only if explicitly configured in environment variables
    if (masterOtp && otp === masterOtp) {
      if (isProduction && process.env.ALLOW_PRODUCTION_MASTER_OTP !== 'true') {
        console.warn(`[SECURITY] Master OTP attempt blocked in production for phone: ${phoneNumber}`);
      } else {
        try {
          await redisClient.del(otpKey);
        } catch (redisErr) {
          console.error('[Redis Error] Failed to delete OTP in Redis:', redisErr.message);
        }
        return true;
      }
    }

    if (otpData.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      try {
        await redisClient.del(otpKey);
      } catch (redisErr) {
        console.error('[Redis Error] Failed to delete OTP in Redis:', redisErr.message);
      }
      throw new Error('Maximum verification attempts reached. Please request a new OTP.');
    }

    const isMatch = await compareOTP(otp, otpData.hashedOTP);

    if (!isMatch) {
      otpData.attempts += 1;
      try {
        await redisClient.set(otpKey, JSON.stringify(otpData), {
          KEEPTTL: true
        });
      } catch (redisErr) {
        console.error('[Redis Error] Failed to update OTP attempts in Redis:', redisErr.message);
      }
      throw new Error('Invalid OTP.');
    }

    // OTP is correct, delete it (single-use)
    try {
      await redisClient.del(otpKey);
    } catch (redisErr) {
      console.error('[Redis Error] Failed to delete OTP in Redis:', redisErr.message);
    }
    return true;
  }
}

module.exports = new AuthService();

//create an oder system for the follow up's