const { redisClient } = require('../config/redis');
const Otp = require('../models/Otp');
const smsService = require('./sms.service');
const { generateOTP } = require('../utils/otp');
const { hashData, compareData, hashOTP, compareOTP } = require('../utils/hash');

const OTP_EXPIRY = 300; // 5 minutes in seconds
const MAX_VERIFICATION_ATTEMPTS = 3;

async function tryReconnectRedis() {
  if (redisClient && !redisClient.isOpen && typeof redisClient.connect === 'function') {
    try {
      await redisClient.connect();
    } catch (_) {
      // Driver reconnect strategy handles in background
    }
  }
}

class AuthService {
  async sendOTP(phoneNumber) {
    // For the demo/test number, always use a fixed OTP so reviewers can log in reliably.
    const TEST_PHONE = '9999999999';
    const TEST_OTP = '123456';
    const otp = phoneNumber === TEST_PHONE ? TEST_OTP : generateOTP();
    const hashedOTP = await hashOTP(otp);

    await tryReconnectRedis();

    // 1. Store hashed OTP and attempt count in Redis with MongoDB fallback
    const otpKey = `otp:${phoneNumber}`;
    let storedInRedis = false;
    try {
      if (redisClient && redisClient.isOpen) {
        await redisClient.set(otpKey, JSON.stringify({
          hashedOTP,
          attempts: 0
        }), {
          EX: OTP_EXPIRY
        });
        storedInRedis = true;
      }
    } catch (redisErr) {
      console.error('[Redis Error] Failed to store OTP in Redis:', redisErr.message);
    }

    if (!storedInRedis) {
      try {
        console.warn(`[OTP] Storing OTP in MongoDB fallback for ${phoneNumber}`);
        await Otp.findOneAndUpdate(
          { phoneNumber },
          {
            phoneNumber,
            hashedOTP,
            attempts: 0,
            expiresAt: new Date(Date.now() + OTP_EXPIRY * 1000)
          },
          { upsert: true, returnDocument: 'after' }
        );
      } catch (mongoErr) {
        console.error('[Mongo Error] Failed to store OTP in MongoDB fallback:', mongoErr.message);
        throw new Error('Verification service is temporarily unavailable. Please try again later.');
      }
    }

    // 2. Send SMS via SmsService (which handles Redis-based rate limiting internally)
    await smsService.sendOTP(phoneNumber, otp);

    return otp; // Return for development/testing
  }

  async verifyOTP(phoneNumber, otp) {
    await tryReconnectRedis();

    const otpKey = `otp:${phoneNumber}`;
    let otpData = null;
    let fromMongo = false;

    // Try reading from Redis first
    try {
      if (redisClient && redisClient.isOpen) {
        const otpDataRaw = await redisClient.get(otpKey);
        if (otpDataRaw) {
          otpData = JSON.parse(otpDataRaw);
        }
      }
    } catch (redisErr) {
      console.error('[Redis Error] Failed to get OTP from Redis:', redisErr.message);
    }

    // Fallback to MongoDB if not found in Redis or Redis was down
    if (!otpData) {
      try {
        const mongoOtp = await Otp.findOne({ phoneNumber });
        if (mongoOtp) {
          if (mongoOtp.expiresAt && mongoOtp.expiresAt < new Date()) {
            await Otp.deleteOne({ _id: mongoOtp._id });
          } else {
            otpData = {
              hashedOTP: mongoOtp.hashedOTP,
              attempts: mongoOtp.attempts || 0,
              _id: mongoOtp._id
            };
            fromMongo = true;
          }
        }
      } catch (mongoErr) {
        console.error('[Mongo Error] Failed to get OTP from MongoDB fallback:', mongoErr.message);
      }
    }

    if (!otpData) {
      throw new Error('OTP expired or not found.');
    }

    const masterOtp = process.env.MASTER_OTP;
    const isProduction = process.env.NODE_ENV === 'production';

    // Allow Master OTP only if explicitly configured in environment variables
    if (masterOtp && otp === masterOtp) {
      if (isProduction && process.env.ALLOW_PRODUCTION_MASTER_OTP !== 'true') {
        console.warn(`[SECURITY] Master OTP attempt blocked in production for phone: ${phoneNumber}`);
      } else {
        if (fromMongo) {
          await Otp.deleteOne({ phoneNumber }).catch(() => {});
        } else {
          try {
            await redisClient.del(otpKey);
          } catch (redisErr) {
            console.error('[Redis Error] Failed to delete OTP in Redis:', redisErr.message);
          }
        }
        return true;
      }
    }

    if (otpData.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      if (fromMongo) {
        await Otp.deleteOne({ phoneNumber }).catch(() => {});
      } else {
        try {
          await redisClient.del(otpKey);
        } catch (redisErr) {
          console.error('[Redis Error] Failed to delete OTP in Redis:', redisErr.message);
        }
      }
      throw new Error('Maximum verification attempts reached. Please request a new OTP.');
    }

    const isMatch = await compareOTP(otp, otpData.hashedOTP);

    if (!isMatch) {
      otpData.attempts += 1;
      if (fromMongo) {
        await Otp.updateOne({ phoneNumber }, { $inc: { attempts: 1 } }).catch(() => {});
      } else {
        try {
          await redisClient.set(otpKey, JSON.stringify(otpData), {
            KEEPTTL: true
          });
        } catch (redisErr) {
          console.error('[Redis Error] Failed to update OTP attempts in Redis:', redisErr.message);
        }
      }
      throw new Error('Invalid OTP.');
    }

    // OTP is correct, delete it (single-use)
    if (fromMongo) {
      await Otp.deleteOne({ phoneNumber }).catch(() => {});
    } else {
      try {
        await redisClient.del(otpKey);
      } catch (redisErr) {
        console.error('[Redis Error] Failed to delete OTP in Redis:', redisErr.message);
      }
    }
    return true;
  }
}

module.exports = new AuthService();
