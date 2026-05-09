require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function listProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const p = await Product.findOne({ title: /Thioshield/i });
    if (p) {
      console.log(`Product: ${p.title}`);
      console.log('Variants:');
      p.variants.forEach(v => console.log(`- Size: ${v.size}, Price: ${v.price}, CompareAtPrice: ${v.compareAtPrice}`));
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

listProducts();
