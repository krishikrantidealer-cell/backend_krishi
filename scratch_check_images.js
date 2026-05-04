require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function checkImages() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const product = await Product.findOne();
    if (product) {
      console.log('Product Title:', product.title);
      console.log('Thumbnail URL:', product.thumbnail);
    } else {
      console.log('No products found.');
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

checkImages();
