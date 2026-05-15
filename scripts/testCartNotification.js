const mongoose = require('mongoose');
require('dotenv').config();

async function testCart() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB...");

    // Set updatedAt to 5 hours ago
    const testDate = new Date(Date.now() - 5 * 60 * 60 * 1000);

    const res = await mongoose.connection.db.collection('carts').updateOne(
      {}, 
      { 
        $set: { updatedAt: testDate },
        $unset: { lastReminderSentAt: "" } 
      }
    );

    console.log("Cart marked as abandoned (5 hours ago)!", res);
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    mongoose.connection.close();
    process.exit();
  }
}

testCart();
