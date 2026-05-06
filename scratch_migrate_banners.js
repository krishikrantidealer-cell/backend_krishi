require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Banner = require('./models/Banner');

const typeMapping = {
  homebanners: 'home',
  categorybanners: 'category',
  categorycardbanners: 'category_card',
  bestoffersbanners: 'best_offers',
  agritipsbanners: 'agri_tips',
  customcollectionsbanners: 'custom_collections'
};

async function migrateBanners() {
  await connectDB();
  const db = mongoose.connection.db;
  const collection = db.collection('banners');
  
  // Find monolithic document
  const allDocs = await collection.find({}).toArray();
  if (allDocs.length === 0) {
    console.log("No banners found in collection to migrate.");
    process.exit(0);
  }
  
  // If there's already individual banners, we don't want to mess things up if they migrated already
  const monolithic = allDocs.find(doc => doc.homebanners && Array.isArray(doc.homebanners));
  if (!monolithic) {
    console.log("No monolithic document found. Migration might have already run or banners are in proper format.");
    process.exit(0);
  }

  console.log("Found monolithic banner document! Migrating...");
  
  const bannersToInsert = [];
  
  for (const [arrayKey, mappedType] of Object.entries(typeMapping)) {
    const urls = monolithic[arrayKey];
    if (urls && Array.isArray(urls)) {
      console.log(`Processing ${urls.length} banners of type "${mappedType}" (${arrayKey})...`);
      urls.forEach((rawUrl, index) => {
        // Fix the domain from authenticated storage.cloud.google.com to public storage.googleapis.com
        const publicUrl = rawUrl.replace('storage.cloud.google.com', 'storage.googleapis.com');
        
        bannersToInsert.push({
          title: `${mappedType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Banner ${index + 1}`,
          imageUrl: publicUrl,
          priority: index,
          type: mappedType,
          isActive: true,
          redirectType: 'none'
        });
      });
    }
  }

  if (bannersToInsert.length > 0) {
    console.log(`Inserting ${bannersToInsert.length} individual, optimized banner documents...`);
    // Insert new individual documents via Mongoose so they strictly conform to schema
    await Banner.insertMany(bannersToInsert);
    
    console.log("Deleting old monolithic document...");
    await collection.deleteOne({ _id: monolithic._id });
    
    console.log("Migration completed successfully!");
  } else {
    console.log("No banners to insert.");
  }

  process.exit(0);
}

migrateBanners();
