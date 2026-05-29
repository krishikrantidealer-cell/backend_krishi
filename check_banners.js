const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Banner = require('./models/Banner');
  const banners = await Banner.find({ type: 'custom_collections' }).lean();
  console.log('Total custom collections banners:', banners.length);
  for (const b of banners) {
    console.log(`Banner: ${b.title}`);
    console.log(`  imageUrl: ${b.imageUrl}`);
    console.log(`  redirectTarget: ${b.redirectTarget}`);
    console.log(`  redirectType: ${b.redirectType}`);
  }
  process.exit(0);
}

main().catch(console.error);
