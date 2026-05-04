require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Collection = require('./models/Collection');

async function listCollections() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const collections = await Collection.find();
    console.log('Collections in DB:');
    collections.forEach(c => console.log(`- ${c.name} (${c.slug})`));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

listCollections();
