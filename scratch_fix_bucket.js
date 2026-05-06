require('dotenv').config({ path: __dirname + '/.env' });
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { processAndUploadProductImage, deleteFromGCS } = require('./utils/gcs');
const mongoose = require('mongoose');

async function fixBucketFiles() {
  let storage;
  let keyPath = process.env.GCS_KEY_FILE_PATH || './config/gcs-key.json';
  if (!path.isAbsolute(keyPath)) {
    keyPath = path.join(__dirname, keyPath);
  }

  if (process.env.GCS_KEY_JSON) {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: JSON.parse(process.env.GCS_KEY_JSON)
    });
  } else {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      keyFilename: keyPath,
    });
  }

  const bucketName = process.env.GCS_BUCKET_NAME;
  const bucket = storage.bucket(bucketName);

  const filesToFix = ['products/Grow booster.jpg', 'products/Suvirat.webp'];

  for (const filePath of filesToFix) {
    console.log(`Fixing ${filePath}...`);
    try {
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      if (!exists) {
        console.log(`File ${filePath} not found, skipping.`);
        continue;
      }

      console.log(`Downloading ${filePath}...`);
      const [buffer] = await file.download();

      // Generate a new ObjectId since it's not tied to a DB product yet
      const fakeProductId = new mongoose.Types.ObjectId().toString();

      console.log(`Processing and uploading to products/${fakeProductId}/...`);
      const result = await processAndUploadProductImage(buffer, path.basename(filePath), fakeProductId);
      
      console.log(`Success! New URLs:`);
      console.log(`- Thumb: ${result.thumb}`);
      console.log(`- Medium: ${result.medium}`);
      console.log(`- Original: ${result.original}`);

      console.log(`Deleting original loose file...`);
      await file.delete();
      console.log(`Original file deleted.\n`);
    } catch (e) {
      console.error(`Error fixing ${filePath}:`, e);
    }
  }

  process.exit(0);
}

fixBucketFiles();
