const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const normalizeWord = (w) => {
  return w.toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s$/, ''); // singularize
};

const getWords = (str) => {
  return str.split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(normalizeWord)
    .filter(Boolean);
};

const matchSubCollectionToBanner = (subName, banner) => {
  const subNameLower = subName.trim().toLowerCase();
  const titleLower = (banner.title || '').toLowerCase();
  const targetLower = (banner.redirectTarget || '').toLowerCase();
  const urlLower = (banner.imageUrl || '').toLowerCase();
  
  if (
    titleLower.includes(subNameLower) || 
    targetLower === subNameLower || 
    urlLower.includes(`/${subNameLower}.`) || 
    urlLower.includes(`/${subNameLower}%`) ||
    urlLower.includes(`_${subNameLower}`) ||
    urlLower.includes(subNameLower)
  ) {
    return true;
  }
  
  const baseTitle = banner.title.includes('/') ? banner.title.split('/').pop() : banner.title;
  const subWords = getWords(subName);
  const bannerWords = getWords(baseTitle);
  
  if (subWords.length > 0 && bannerWords.length > 0) {
    if (subWords.every(w => bannerWords.includes(w)) || bannerWords.every(w => subWords.includes(w))) {
      return true;
    }
  }
  
  return false;
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Collection = require('./models/Collection');
  const Banner = require('./models/Banner');

  const collections = await Collection.find({ isActive: true }).lean();
  const customCollectionBanners = await Banner.find({ isActive: true, type: 'custom_collections' }).lean();

  console.log(`Found ${collections.length} active collections.`);
  console.log(`Found ${customCollectionBanners.length} custom collections banners.`);

  for (const col of collections) {
    console.log(`\nCollection: "${col.name}"`);
    const updatedSubCollections = (col.subCollections || []).map(sub => {
      let subImage = sub.image;
      let matchedBannerTitle = null;
      if ((!subImage || subImage === 'undefined' || subImage === 'null') && customCollectionBanners.length > 0) {
        const matchingBanner = customCollectionBanners.find(b => matchSubCollectionToBanner(sub.name, b));
        if (matchingBanner) {
          subImage = matchingBanner.imageUrl;
          matchedBannerTitle = matchingBanner.title;
        }
      }
      return {
        name: sub.name,
        originalImage: sub.image,
        resolvedImage: subImage,
        matchedBanner: matchedBannerTitle
      };
    });

    for (const sub of updatedSubCollections) {
      console.log(`  - Sub: "${sub.name}"`);
      console.log(`    Original In DB: "${sub.originalImage}"`);
      console.log(`    Resolved Image: "${sub.resolvedImage}"`);
      if (sub.matchedBanner) {
        console.log(`    Matched Banner: "${sub.matchedBanner}"`);
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
