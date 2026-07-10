require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const pushService = require('../services/pushNotificationSegment.service');
const whatsappService = require('../services/whatsappAutomation.service');

/**
 * TEST TOOL: Verify your notification systems
 * Run this with: node scripts/test_automations.js --phone 91XXXXXXXXXX
 */

const testAutomations = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to Database');

    const args = process.argv.slice(2);
    const phoneArg = args.indexOf('--phone');
    const targetPhone = phoneArg !== -1 ? args[phoneArg + 1] : null;

    if (!targetPhone) {
      console.log('❌ Error: Please provide a target phone number.');
      console.log('Usage: node scripts/test_automations.js --phone 91XXXXXXXXXX');
      process.exit(1);
    }

    const user = await User.findOne({ phoneNumber: targetPhone });
    if (!user) {
      console.log(`❌ User with phone ${targetPhone} not found in DB.`);
      process.exit(1);
    }

    console.log(`\n--- Starting Tests for User: ${user.firstName || 'Dealer'} (${targetPhone}) ---\n`);

    // 1. Test WhatsApp Welcome
    console.log('1. Testing WhatsApp Welcome...');
    await whatsappService.notifyKycApproved(user);
    console.log('   (Check WhatsApp for KYC Approved message)');

    // 2. Test Push Notification
    console.log('\n2. Testing Push Notification (Segment A)...');
    const template = pushService.getNotificationForSegment('A');
    const notificationService = require('../services/notification.service');
    if (user.fcmToken) {
      await notificationService.sendUtilityNotification(user._id, template.title, template.body, '/profile');
      console.log('   ✅ Push sent to device');
    } else {
      console.log('   ⚠️ No FCM Token found for this user. Push skipped.');
    }

    // 3. Test Seasonal Push
    console.log('\n3. Testing Seasonal Push...');
    const seasonal = pushService.getNotificationForSegment('SEASONAL');
    if (user.fcmToken) {
      await notificationService.sendMarketingNotification(user._id, seasonal.title, seasonal.body, '/');
      console.log(`   ✅ Sent: ${seasonal.title}`);
    }

    console.log('\n--- All tests triggered. Check your device! ---');
    process.exit(0);

  } catch (error) {
    console.error('Fatal Test Error:', error);
    process.exit(1);
  }
};

testAutomations();
