require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const totalProducts = await Product.countDocuments();
    const featuredProducts = await Product.countDocuments({ isFeatured: true });
    const productsWithCollections = await Product.countDocuments({ assignedCollections: { $exists: true, $not: { $size: 0 } } });

    console.log(`Total Products: ${totalProducts}`);
    console.log(`Featured Products: ${featuredProducts}`);
    console.log(`Products with Collections: ${productsWithCollections}`);

    if (featuredProducts > 0) {
      const sampleFeatured = await Product.findOne({ isFeatured: true });
      console.log('Sample Featured Product:', sampleFeatured.title);
    }

    if (productsWithCollections > 0) {
      const sampleCollection = await Product.findOne({ assignedCollections: { $exists: true, $not: { $size: 0 } } });
      console.log('Sample Product with Collections:', sampleCollection.title, 'Collections:', sampleCollection.assignedCollections);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking data:', error);
    process.exit(1);
  }
}

checkData();
