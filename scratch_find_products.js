require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const Product = require('./models/Product');
const connectDB = require('./config/db');

async function fixProducts() {
  await connectDB();
  
  const products = await Product.find({
    $or: [
      { thumbnail: { $regex: /Grow booster|Suvirat/i } },
      { images: { $regex: /Grow booster|Suvirat/i } },
      { originalImages: { $regex: /Grow booster|Suvirat/i } }
    ]
  });

  console.log(`Found ${products.length} products matching the bucket filenames.`);
  products.forEach(p => {
    console.log(`- ID: ${p._id}`);
    console.log(`  Title: ${p.title}`);
    console.log(`  Thumbnail: ${p.thumbnail}`);
  });

  process.exit(0);
}

fixProducts();
