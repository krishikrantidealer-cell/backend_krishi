require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function listProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const products = await Product.find().select('title').limit(50);
    console.log('Products in DB:');
    products.forEach(p => console.log(`- ${p.title}`));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

listProducts();
