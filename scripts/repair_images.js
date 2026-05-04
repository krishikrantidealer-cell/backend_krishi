const mongoose = require('mongoose');
const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const { Storage } = require('@google-cloud/storage');
require('dotenv').config();

// Models
const Product = require('../models/Product');

// GCS Setup
// Using path.resolve to handle the relative path from .env properly
const gcsKeyPath = path.resolve(__dirname, '..', process.env.GCS_KEY_FILE_PATH || './config/gcs-key.json');
const storage = new Storage({ keyFilename: gcsKeyPath });
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

async function repairProductImages() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');

    const products = await Product.find({});
    console.log(`Found ${products.length} products to check.`);

    for (const product of products) {
      console.log(`Checking Product: ${product.title} (${product._id})`);

      // 1. Find the thumbnail path to extract the folder structure
      // Example: .../products/ID/TIMESTAMP/thumb.webp
      const thumbUrl = product.thumbnail;
      if (!thumbUrl || !thumbUrl.includes('/products/')) continue;

      const urlParts = thumbUrl.split('/');
      const fileName = urlParts.pop(); // thumb.webp
      const timestamp = urlParts.pop();
      const productId = urlParts.pop();
      
      const folderPath = `products/${productId}/${timestamp}`;
      const originalPath = `${folderPath}/original.webp`;
      const mediumPath = `${folderPath}/medium.webp`;
      const thumbPath = `${folderPath}/thumb.webp`;

      console.log(`  Processing folder: ${folderPath}`);

      try {
        // 2. Download the original image from GCS
        const [originalBuffer] = await bucket.file(originalPath).download();
        
        // 3. Re-generate Medium (600x600, contain)
        console.log('  Generating Medium...');
        const mediumBuffer = await sharp(originalBuffer)
          .resize(600, 600, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          })
          .webp({ quality: 80 })
          .toBuffer();
        await bucket.file(mediumPath).save(mediumBuffer, { contentType: 'image/webp' });

        // 4. Re-generate Thumb (200x200, contain)
        console.log('  Generating Thumb...');
        const thumbBuffer = await sharp(originalBuffer)
          .resize(200, 200, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          })
          .webp({ quality: 80 })
          .toBuffer();
        await bucket.file(thumbPath).save(thumbBuffer, { contentType: 'image/webp' });

        console.log('  Success!');
      } catch (err) {
        console.error(`  Error processing ${product.title}: ${err.message}`);
      }
    }

    console.log('All products processed!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

repairProductImages();
