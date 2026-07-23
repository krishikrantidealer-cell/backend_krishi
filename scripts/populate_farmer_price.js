require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const Product = require('../models/Product');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found in environment!');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected successfully.');

  console.log('Fetching all products...');
  const products = await Product.find({});
  console.log(`Found ${products.length} products.`);

  let updatedProductsCount = 0;
  let updatedVariantsCount = 0;

  for (const product of products) {
    let modified = false;
    if (product.variants && product.variants.length > 0) {
      for (const variant of product.variants) {
        if (!variant.farmerPrice || variant.farmerPrice <= 0) {
          const baseReferencePrice = (variant.compareAtPrice && variant.compareAtPrice > 0) 
            ? variant.compareAtPrice 
            : variant.price;
          
          // Populate farmer price with reference price + 200 (or at least 200)
          variant.farmerPrice = Math.round(baseReferencePrice + 200);
          modified = true;
          updatedVariantsCount++;
        }
      }
    }
    if (modified) {
      await product.save();
      updatedProductsCount++;
    }
  }

  console.log(`Successfully updated ${updatedVariantsCount} variants across ${updatedProductsCount} products.`);
  await mongoose.disconnect();
  console.log('Disconnected. Script complete.');
}

run().catch(err => {
  console.error('Error running script:', err);
  mongoose.disconnect();
});
