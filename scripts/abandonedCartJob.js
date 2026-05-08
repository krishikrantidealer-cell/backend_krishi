const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const User = require('../models/User');
const notificationService = require('../services/notification.service');
require('dotenv').config();

// Connect to Database
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/krishi');

async function checkAbandonedCarts() {
  console.log("Starting Abandoned Cart Scan...");
  
  try {
    // 1. Find all carts that have items in them
    const activeCarts = await Cart.find({ 
      items: { $exists: true, $not: { $size: 0 } } 
    }).populate('user');

    for (let cart of activeCarts) {
      // 2. Check if the cart has been abandoned for more than 24 hours
      const hoursSinceLastUpdate = (new Date() - new Date(cart.updatedAt)) / (1000 * 60 * 60);

      // E.g., if updated more than 2 hours ago, send a reminder
      if (hoursSinceLastUpdate > 2 && hoursSinceLastUpdate < 24) {
        
        // 3. Trigger the Marketing Notification!
        await notificationService.sendMarketingNotification(
          cart.user._id,
          "You left something behind! 🛒",
          "Your items are waiting for you. Complete your checkout before stock runs out!",
          "/cart" // Deep link directly to their cart!
        );
        
        console.log(`Abandoned cart reminder sent to user: ${cart.user.phoneNumber}`);
        
        // Note: In a real system, you would tag this cart with "reminderSent: true"
        // so you don't spam them every hour.
      }
    }
  } catch (error) {
    console.error("Error checking abandoned carts:", error);
  } finally {
    process.exit();
  }
}

checkAbandonedCarts();
