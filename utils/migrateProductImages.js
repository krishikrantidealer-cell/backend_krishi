const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const { processAndUploadProductImage } = require('./gcs');

dotenv.config({ path: path.join(__dirname, '../.env') });

function convertToDirectLink(url) {
  if (url.includes('drive.google.com')) {
    const fileId = url.match(/\/d\/(.+?)\//);
    if (fileId && fileId[1]) {
      return `https://drive.google.com/uc?export=download&id=${fileId[1]}`;
    }
  }
  return url;
}

async function migrate() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected.');

    const products = await Product.find({}).lean();
    console.log(`🚀 Found ${products.length} products to migrate.`);

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`\n[${i + 1}/${products.length}] Migrating: ${product.title}`);

      // Skip if already migrated (has a GCS thumbnail)
      if (product.thumbnail && product.thumbnail.includes('storage.googleapis.com')) {
        console.log('⏩ Already migrated. Skipping.');
        continue;
      }

      const imageUrls = product.images || [];
      if (imageUrls.length === 0) {
        console.log('⚠️ No images found for this product.');
        continue;
      }

      const processedThumbnails = [];
      const processedMedium = [];
      const processedOriginal = [];

      for (const url of imageUrls) {
        try {
          const directUrl = convertToDirectLink(url);
          console.log(`  ⏬ Downloading: ${directUrl}`);
          const response = await axios.get(directUrl, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(response.data, 'binary');

          console.log(`  ⚙️ Processing and Uploading to GCS...`);
          const result = await processAndUploadProductImage(buffer, 'migrated_image.jpg', product._id);
          
          processedThumbnails.push(result.thumb);
          processedMedium.push(result.medium);
          processedOriginal.push(result.original);
        } catch (err) {
          console.error(`  ❌ Failed to process image ${url}:`, err.message);
        }
      }

      if (processedThumbnails.length > 0) {
        // 1. Update Product Listing with all GCS generated URLs
        await Product.updateOne(
          { _id: product._id },
          { 
            $set: { 
              thumbnail: processedThumbnails[0],
              images: processedThumbnails,
              mediumImages: processedMedium,
              originalImages: processedOriginal
            }
          }
        );

        console.log('✅ Migration successful for this product.');
      }
    }

    console.log('\n✨ ALL PRODUCTS MIGRATED TO GOOGLE CLOUD STORAGE! ✨');
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  }
}

migrate();
