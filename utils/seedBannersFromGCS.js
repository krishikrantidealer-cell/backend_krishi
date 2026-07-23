require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Banner = require('../models/Banner');

const typeMapping = {
  homebanners: 'home',
  categorybanners: 'category',
  categorycardbanners: 'category_card',
  bestoffersbanners: 'best_offers',
  agritipsbanners: 'agri_tips',
  customcollectionsbanners: 'custom_collections'
};

async function seedBanners() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    console.log("Clearing existing banners from database...");
    await Banner.deleteMany({});
    console.log("Existing banners cleared.");

    const { bucket } = require('./gcs');
    if (!bucket) {
      throw new Error("No GCS bucket configured. Check GCS_BUCKET_NAME env var.");
    }
    const [files] = await bucket.getFiles();
    console.log(`Retrieved ${files.length} files from bucket. Parsing banners...`);

    const bannersToInsert = [];
    const categoryNames = ['Insecticides', 'Fungicides', 'Fertilizers', 'Bio-Products', 'PGRs', 'Herbicides'];
    const collectionNames = ['Paddy', 'Wheat', 'Maize', 'Soybean', 'Sugarcane', 'Cotton'];

    files.forEach((file) => {
      // Skip directory placeholders
      if (file.name.endsWith('/')) return;

      const parts = file.name.split('/');
      if (parts.length < 2) return; // Must be inside a subfolder

      const folder = parts[0];
      const filenameWithExt = parts.slice(1).join('/');
      const filename = filenameWithExt.substring(0, filenameWithExt.lastIndexOf('.')) || filenameWithExt;

      const mappedType = typeMapping[folder];
      if (!mappedType) return; // Skip if folder doesn't match a banner type

      // URL encode the path segments so spaces and special chars render perfectly
      const encodedName = file.name.split('/').map(seg => encodeURIComponent(seg)).join('/');
      const imageUrl = `https://storage.googleapis.com/${bucket.name}/${encodedName}`;

      let redirectType = 'none';
      let redirectTarget = undefined;

      // Smart Deep-Link Routing!
      if (mappedType === 'category' || mappedType === 'category_card') {
        const matchedCat = categoryNames.find(cat => 
          filename.toLowerCase().includes(cat.toLowerCase())
        );
        if (matchedCat) {
          redirectType = 'category';
          redirectTarget = matchedCat;
        }
      } else if (mappedType === 'custom_collections') {
        const matchedCol = collectionNames.find(col => 
          filename.toLowerCase().includes(col.toLowerCase())
        );
        if (matchedCol) {
          redirectType = 'collection';
          redirectTarget = matchedCol;
        }
      }

      bannersToInsert.push({
        title: filename,
        imageUrl: imageUrl,
        type: mappedType,
        priority: bannersToInsert.filter(b => b.type === mappedType).length,
        isActive: true,
        redirectType: redirectType,
        redirectTarget: redirectTarget
      });
    });

    console.log(`Parsed ${bannersToInsert.length} banners from the bucket.`);

    if (bannersToInsert.length > 0) {
      console.log("Inserting banners into MongoDB...");
      await Banner.insertMany(bannersToInsert);
      console.log(`✅ Successfully stored ${bannersToInsert.length} banners in the database!`);
    } else {
      console.log("⚠️ No matching banners found in the bucket folders.");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to seed banners from GCS:", error.message);
    process.exit(1);
  }
}

seedBanners();
