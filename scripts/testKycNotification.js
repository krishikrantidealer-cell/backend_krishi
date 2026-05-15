const mongoose = require('mongoose');
require('dotenv').config();
const userService = require('../services/user.service');

async function testKyc() {
  const status = process.argv[2] || 'verified';
  const reason = process.argv[3] || '';

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB...");

    // Find the first user (typically you)
    const user = await mongoose.connection.db.collection('users').findOne({});
    if (!user) {
      console.error("No user found in database!");
      return;
    }

    console.log(`Updating KYC status for ${user.phoneNumber} to: ${status}...`);
    
    await userService.updateKycStatus(user._id, status, reason);

    console.log("KYC Status Updated and Notification Sent!");
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    mongoose.connection.close();
    process.exit();
  }
}

testKyc();
