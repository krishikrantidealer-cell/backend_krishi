const mongoose = require('mongoose');
require('dotenv').config();
const Coupon = require('./models/Coupon');

async function checkCoupon() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/krishi');
    console.log('Connected to MongoDB');

    const coupon = await Coupon.findOne({ code: 'FREECOMBO' });
    if (!coupon) {
      console.log('Coupon FREECOMBO not found');
    } else {
      console.log('Coupon Details:', JSON.stringify(coupon, null, 2));
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkCoupon();
