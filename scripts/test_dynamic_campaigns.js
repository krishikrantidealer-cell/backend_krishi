const mongoose = require('mongoose');
const pushNotificationSegmentService = require('../services/pushNotificationSegment.service');
const NotificationCampaign = require('../models/NotificationCampaign');

async function testDynamicEngine() {
  console.log("=== Testing 100% Dynamic Push Notification Campaign Engine ===");
  try {
    // 1. Ensure seed campaigns
    await pushNotificationSegmentService.ensureSeedCampaigns();
    console.log("✅ Seed check complete.");

    // 2. Query campaigns
    const stats = await pushNotificationSegmentService.getSegmentStats();
    console.log(`✅ Loaded ${stats.campaigns.length} campaigns from MongoDB.`);
    console.log(`Total users in system: ${stats.totalUsers}, with FCM tokens: ${stats.usersWithToken}`);

    // Print sample campaign
    const sample = stats.campaigns.find(c => c.segmentKey === 'A');
    if (sample) {
      console.log(`\nSample Segment A:`);
      console.log(`- Name: ${sample.name}`);
      console.log(`- Scheduled Time: ${sample.scheduledTime} IST`);
      console.log(`- Mode: ${sample.mode}`);
      console.log(`- Active Templates: ${sample.templates.length}`);
      console.log(`- Today's Rotating Template: "${sample.todayTemplate?.title}"`);
    }

  } catch (err) {
    console.error("❌ Error during test:", err.message);
  }
}

module.exports = testDynamicEngine;
