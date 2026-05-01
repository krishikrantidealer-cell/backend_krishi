const axios = require('axios');
const { redisClient } = require('../config/redis');

// SMS Configuration (These should be in .env)
const SMS_DAILY_LIMIT = 5;
const SMS_COOLDOWN = 60; // 60 seconds between sends
const SMS_DAILY_WINDOW = 24 * 60 * 60; // 24 hours

class SmsService {
  /**
   * Send OTP via SMS with Redis-based rate limiting
   */
  async sendOTP(phoneNumber, otp) {
    const cooldownKey = `sms_cooldown:${phoneNumber}`;
    const dailyKey = `sms_daily_count:${phoneNumber}`;

    // 0. Whitelist for Testing
    const testNumber = '8085042656';
    if (phoneNumber === testNumber) {
      console.log(`[SMS-WHITELIST] Skipping guards for test number: ${phoneNumber}`);
      // Skip cooldown and daily limits
    } else {
      // 1. Check Cooldown (60s)
      const onCooldown = await redisClient.get(cooldownKey);
      if (onCooldown) {
        throw new Error(`Please wait ${SMS_COOLDOWN} seconds before requesting another OTP.`);
      }

      // 2. Check Daily Limit
      const dailyCount = await redisClient.get(dailyKey);
      if (dailyCount && parseInt(dailyCount) >= SMS_DAILY_LIMIT) {
        throw new Error('Daily OTP limit reached. Please try again after 24 hours.');
      }
    }

    // 3. Integrate with SMS Provider
    try {
      if (process.env.NODE_ENV === 'production') {
        await this._sendViaProvider(phoneNumber, otp);
      } else {
        console.log(`[SMS-DEV-LOG] Sending OTP ${otp} to ${phoneNumber}`);
      }

      // 4. Update Redis Guards on success
      await redisClient.set(cooldownKey, '1', { EX: SMS_COOLDOWN });

      if (phoneNumber === testNumber) return; // Don't increment for test number
      if (!dailyCount) {
        await redisClient.set(dailyKey, '1', { EX: SMS_DAILY_WINDOW });
      } else {
        await redisClient.incr(dailyKey);
      }

      return true;
    } catch (error) {
      console.error('SMS Provider Error:', error.message);
      throw new Error('Failed to send SMS. Please try again later.');
    }
  }

  /**
   * Private method to handle provider-specific logic
   */
  async _sendViaProvider(phoneNumber, otp) {
    // Example for a generic HTTP-based SMS gateway (like MSG91 or TextLocal)
    /*
    const apiKey = process.env.SMS_API_KEY;
    const url = `https://api.example.com/send?apiKey=${apiKey}&to=${phoneNumber}&message=Your OTP is ${otp}`;
    await axios.get(url);
    */

    // For now, we'll just log it. You can replace this with Twilio, AWS SNS, etc.
    console.log(`[PROD-SMS-STUB] Sending OTP to ${phoneNumber}`);
  }
}

module.exports = new SmsService();
