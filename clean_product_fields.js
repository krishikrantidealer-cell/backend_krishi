const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  console.log('Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected!');

  const db = mongoose.connection.db;
  const collection = db.collection('products');

  console.log('Updating product variants in the database...');
  const result = await collection.updateMany(
    {},
    {
      $unset: {
        'variants.$[].price10_30': '',
        'variants.$[].price30_50': '',
        'variants.$[].price50_plus': ''
      }
    }
  );

  console.log(`Success! Updated ${result.matchedCount} products (modified ${result.modifiedCount}).`);
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
