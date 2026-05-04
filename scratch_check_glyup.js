require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');
const Category = require('./models/Category');

async function checkGlyup() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const glyup = await Product.findOne({ title: /GLYUP/ }).populate('categoryId');
    if (glyup) {
      console.log(`Product: ${glyup.title}`);
      console.log(`Category: ${glyup.categoryId.name}`);
    } else {
      console.log('Product GLYUP not found.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking GLYUP:', error);
    process.exit(1);
  }
}

checkGlyup();
