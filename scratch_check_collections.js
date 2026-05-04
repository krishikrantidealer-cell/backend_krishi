require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Collection = require('./models/Collection');
const Product = require('./models/Product');

async function checkCollections() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const totalCollections = await Collection.countDocuments();
    console.log(`Total Collections: ${totalCollections}`);

    const collections = await Collection.find();
    for (const col of collections) {
      const productCount = await Product.countDocuments({ assignedCollections: col.name });
      console.log(`- ${col.name} (${col.slug}): ${productCount} products`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking collections:', error);
    process.exit(1);
  }
}

checkCollections();
