const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function setupTTL() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI is not defined in the environment variables.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected successfully.');

  const db = mongoose.connection.db;
  const collectionName = 'events';

  // Check if collection exists
  const collections = await db.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    console.log(`Collection "${collectionName}" does not exist yet. It will be created automatically with the model TTL schema when the first event is logged.`);
    process.exit(0);
  }

  const eventsCollection = db.collection(collectionName);
  
  console.log('Fetching existing indexes...');
  const indexes = await eventsCollection.indexes();
  console.log('Current Indexes:', JSON.stringify(indexes, null, 2));

  // Find any index on 'timestamp'
  for (const index of indexes) {
    const isTimestampIndex = index.key && index.key.timestamp !== undefined;
    const isTTLIndex = index.expireAfterSeconds !== undefined;

    if (isTimestampIndex) {
      if (isTTLIndex && index.expireAfterSeconds === 90 * 24 * 60 * 60) {
        console.log('✅ Gold Standard TTL Index of 90 days already exists on "timestamp" field.');
        process.exit(0);
      } else {
        console.log(`Found conflicting/non-matching index: "${index.name}". Dropping it to rebuild TTL index...`);
        await eventsCollection.dropIndex(index.name);
        console.log(`Index "${index.name}" dropped dropped successfully.`);
      }
    }
  }

  console.log('Creating 90-day TTL Index on "timestamp" field...');
  await eventsCollection.createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'timestamp_ttl_90d' }
  );
  
  console.log('✅ TTL Index created successfully.');
  
  const updatedIndexes = await eventsCollection.indexes();
  console.log('Updated Indexes:', JSON.stringify(updatedIndexes, null, 2));
  
  process.exit(0);
}

setupTTL().catch((err) => {
  console.error('Fatal Error setting up TTL:', err);
  process.exit(1);
});
