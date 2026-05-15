const mongoose = require('mongoose');
const Order = require('./models/Order');
const User = require('./models/User');
const notificationService = require('./services/notification.service');
require('dotenv').config();

async function testFullFlow() {
  try {
    console.log("--- Initializing Notification Flow Test ---");
    await mongoose.connect(process.env.MONGODB_URI);

    // 1. Get a test user (the one logged into your app)
    const user = await User.findOne({ fcmToken: { $exists: true, $ne: null } });
    if (!user) {
      console.error("ERROR: No user found with an FCM token. Please log into the app first!");
      process.exit(1);
    }
    console.log(`Testing with User: ${user.phoneNumber} (ID: ${user._id})`);

    // 2. SIMULATE: Order Created Notification
    console.log("\n[Step 1] Simulating Order Placed...");
    await notificationService.sendUtilityNotification(
      user._id,
      "Order Confirmed! 🎉",
      "Your test order #SIM-123 has been placed successfully.",
      "/dashboard"
    );
    console.log("Result: Order Placed notification sent to Firebase.");

    // Wait 5 seconds so they don't overlap too much
    console.log("Waiting 5 seconds before next notification...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. SIMULATE: Status Update Notification (Background Style)
    console.log("\n[Step 2] Simulating Background Status Update...");
    // Find a real order ID to make the deep link clickable
    const realOrder = await Order.findOne({ user: user._id });
    const orderId = realOrder ? realOrder._id : "65f123456789012345678901";
    
    await notificationService.sendUtilityNotification(
      user._id,
      "Order Update: Shipped 📦",
      "Your test package is now in transit to your location.",
      `/order_details/${orderId}`
    );
    console.log(`Result: Status Update notification sent for Order: ${orderId}`);

    console.log("\n--- Test Complete! Check your phone. ---");
  } catch (error) {
    console.error("Test Failed:", error);
  } finally {
    mongoose.connection.close();
  }
}

testFullFlow();
