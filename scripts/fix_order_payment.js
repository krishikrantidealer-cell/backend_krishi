const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');

async function fixOrder() {
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('MongoDB URI not found in .env');
    process.exit(1);
  }

  await mongoose.connect(mongoURI);
  console.log('Connected to MongoDB');

  const orderId = 'ORD-438620979';
  const order = await Order.findOne({ orderId });

  if (!order) {
    console.log(`Order ${orderId} not found.`);
  } else {
    console.log(`Found order ${orderId}: totalAmount=${order.totalAmount}, current advance=${order.advanceAmount}, remaining=${order.remainingAmount}`);
    
    // In Razorpay pay_TU5CE2cKx5sZiN, ₹5,510 was paid
    order.paymentMethod = 'Partial';
    order.paymentStatus = 'Partially Paid';
    order.advanceAmount = 5510;
    order.remainingAmount = order.totalAmount - 5510; // 49590
    
    await order.save();
    console.log(`Successfully updated order ${orderId}:`, {
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      advanceAmount: order.advanceAmount,
      remainingAmount: order.remainingAmount
    });
  }

  await mongoose.disconnect();
  console.log('Done.');
}

fixOrder().catch(err => {
  console.error('Error fixing order:', err);
  process.exit(1);
});
