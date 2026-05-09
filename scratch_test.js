require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');
  
  const products = await Product.find({ 'variants.0': { $exists: true } }).limit(5);
  console.log(`Loaded ${products.length} products with variants:`);
  
  for (const p of products) {
    console.log(`\nProduct: "${p.title}"`);
    p.variants.forEach(v => {
      console.log(`  - Size: "${v.size}" | Price: ${v.price} | CompareAtPrice: ${v.compareAtPrice}`);
    });
  }
  
  process.exit(0);
}

test();
