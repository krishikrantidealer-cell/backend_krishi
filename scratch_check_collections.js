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
      console.log(`- ${col.name} (${col._id}) (${col.slug}):`);
      for (const sub of col.subCollections || []) {
        console.log(`  * Sub: ${sub.name} (id: ${sub._id || sub.id}) (slug: ${sub.slug})`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking collections:', error);
    process.exit(1);
  }
}

checkCollections();
