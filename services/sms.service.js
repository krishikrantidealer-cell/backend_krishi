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
    let dailyCount;

    // 0. Whitelist for Testing
    const testNumber = '9999999999';
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
      dailyCount = await redisClient.get(dailyKey);
      if (dailyCount && parseInt(dailyCount) >= SMS_DAILY_LIMIT) {
        throw new Error('Daily OTP limit reached. Please try again after 24 hours.');
      }
    }

    // 3. Integrate with SMS Provider
    try {
      if (phoneNumber === testNumber) {
        console.log(`[SMS-WHITELIST] Bypassing provider send for test number: ${phoneNumber}`);
      } else if (process.env.NODE_ENV === 'production' || process.env.TEST_SMS_PROVIDER === 'airtel_iq') {
        await this._sendViaProvider(phoneNumber, otp);
      } else {
        console.log(`[SMS-DEV-LOG] Sending OTP ${otp} to ${phoneNumber}`);
      }

      // 4. Update Redis Guards on success
      await redisClient.set(cooldownKey, '1', { EX: SMS_COOLDOWN });

      if (phoneNumber === testNumber) return true; // Don't increment for test number
      
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
   * Private method to handle provider-specific logic using Airtel IQ
   */
  async _sendViaProvider(phoneNumber, otp) {
    const customerId = process.env.AIRTEL_IQ_CUSTOMER_ID;
    const username = process.env.AIRTEL_IQ_USERNAME;
    const password = process.env.AIRTEL_IQ_PASSWORD;
    const sourceAddress = process.env.AIRTEL_IQ_SOURCE_ADDRESS;
    const dltTemplateId = process.env.AIRTEL_IQ_DLT_TEMPLATE_ID;
    const entityId = process.env.AIRTEL_IQ_ENTITY_ID;

    // Check if configuration is missing
    if (!customerId || !username || !password || !sourceAddress || !dltTemplateId || !entityId) {
      console.warn('[SMS-SERVICE] Airtel IQ credentials or configs are missing in env. Falling back to log stub.');
      console.log(`[PROD-SMS-STUB] Sending OTP ${otp} to ${phoneNumber}`);
      return;
    }

    // Format phone number to country code standard (91XXXXXXXXXX)
    const cleaned = phoneNumber.replace(/\D/g, '');
    const formattedPhone = cleaned.length === 10 ? '91' + cleaned : cleaned;

    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    // Dynamic message based on approved DLT template
    const templateMessage = process.env.AIRTEL_IQ_MESSAGE_TEMPLATE || 'Your OTP is {otp}.';
    const message = templateMessage.replace('{otp}', otp);

    const payload = {
      customerId,
      destinationAddress: formattedPhone,
      message,
      sourceAddress,
      dltTemplateId,
      entityId,
      messageType: 'OTP'
    };

    try {
      const response = await axios.post('https://iqsms.airtel.in/api/v1/send-sms', payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        }
      });
      console.log(`[SMS-SERVICE] Airtel IQ response:`, response.data);
      return response.data;
    } catch (error) {
      const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
      console.error('[SMS-SERVICE] Airtel IQ API Error:', errorMsg);
      throw new Error(`Airtel IQ Error: ${errorMsg}`);
    }
  }
}

module.exports = new SmsService();
