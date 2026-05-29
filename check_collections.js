const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Collection = require('./models/Collection');
  const collections = await Collection.find({}).lean();
  console.log('Total collections:', collections.length);
  for (const c of collections) {
    console.log(`Collection: ${c.name} (bannerImage: ${c.bannerImage})`);
    if (c.subCollections && c.subCollections.length > 0) {
      console.log('  Sub-collections:');
      for (const sc of c.subCollections) {
        console.log(`    - Name: "${sc.name}"`);
        console.log(`      Image: "${sc.image}"`);
      }
    } else {
      console.log('  No sub-collections.');
    }
  }
  process.exit(0);
}

main().catch(console.error);
