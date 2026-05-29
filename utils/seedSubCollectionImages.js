require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Collection = require('../models/Collection');
const Banner = require('../models/Banner');

const normalizeWord = (w) => {
  return w.toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s$/, ''); // singularize (removes ending 's')
};

const getWords = (str) => {
  return str.split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(normalizeWord)
    .filter(Boolean);
};

const isMatch = (subName, bannerTitle) => {
  const baseTitle = bannerTitle.includes('/') ? bannerTitle.split('/').pop() : bannerTitle;
  
  const subWords = getWords(subName);
  const bannerWords = getWords(baseTitle);
  
  if (subWords.length === 0 || bannerWords.length === 0) return false;
  
  const allSubInBanner = subWords.every(w => bannerWords.includes(w));
  const allBannerInSub = bannerWords.every(w => subWords.includes(w));
  
  return allSubInBanner || allBannerInSub;
};

async function run() {
  try {
    console.log("🔗 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB.");

    const collections = await Collection.find({});
    const customCollectionBanners = await Banner.find({ isActive: true, type: 'custom_collections' }).lean();

    console.log(`Found ${collections.length} collections and ${customCollectionBanners.length} custom collections banners.`);

    let totalUpdated = 0;

    for (let col of collections) {
      console.log(`\nProcessing collection: "${col.name}"...`);
      let subCollectionsChanged = false;

      col.subCollections = col.subCollections.map(sub => {
        let currentImage = sub.image;
        
        // If image is missing, or set to string 'undefined' or 'null'
        if (!currentImage || currentImage === 'undefined' || currentImage === 'null') {
          const matchingBanner = customCollectionBanners.find(b => isMatch(sub.name, b.title));
          if (matchingBanner) {
            console.log(`  🎉 Matched sub-collection "${sub.name}" to banner "${matchingBanner.title}"`);
            console.log(`     URL: ${matchingBanner.imageUrl}`);
            currentImage = matchingBanner.imageUrl;
            subCollectionsChanged = true;
          } else {
            console.log(`  ⚠️ No matching banner found for sub-collection "${sub.name}"`);
          }
        } else {
          console.log(`  ℹ️ Sub-collection "${sub.name}" already has image: ${currentImage}`);
        }

        return {
          _id: sub._id,
          name: sub.name,
          slug: sub.slug,
          isActive: sub.isActive,
          image: currentImage
        };
      });

      if (subCollectionsChanged) {
        // Mark subCollections modified in Mongoose to make sure it saves
        col.markModified('subCollections');
        await col.save();
        console.log(`💾 Saved updates for collection: "${col.name}"`);
        totalUpdated++;
      } else {
        console.log(`⏩ No sub-collection images updated for collection: "${col.name}"`);
      }
    }

    console.log(`\n✨ Seeding completed. Updated ${totalUpdated} collections.`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

run();
