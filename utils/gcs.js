const { Storage } = require('@google-cloud/storage');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');

dotenv.config();

let storage;

if (process.env.GCS_KEY_JSON) {
  // Option A: Load from Environment Variable (Best for Hosting)
  try {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: JSON.parse(process.env.GCS_KEY_JSON)
    });
  } catch (err) {
    console.error('Failed to parse GCS_KEY_JSON:', err.message);
  }
}

if (!storage) {
  // Option B: Load from File (Best for Local Development)
  storage = new Storage({
    projectId: process.env.GCS_PROJECT_ID || 'placeholder',
    keyFilename: process.env.GCS_KEY_FILE_PATH || './config/gcs-key.json',
  });
}

// Safety check to prevent crash on startup if ENV is not set yet
const bucketName = process.env.GCS_BUCKET_NAME;
const bucket = bucketName ? storage.bucket(bucketName) : null;

/**
 * Uploads a file buffer to Google Cloud Storage
 */
const uploadToGCS = async (fileBuffer, destination, contentType) => {
  if (!bucket) {
    throw new Error('GCS Bucket is not configured. Please check your .env file.');
  }
  return new Promise((resolve, reject) => {
    const file = bucket.file(destination);
    const stream = file.createWriteStream({
      metadata: { contentType },
      resumable: false,
    });

    stream.on('error', (err) => reject(err));
    stream.on('finish', async () => {
      try { await file.makePublic(); } catch (e) { }
      resolve(`https://storage.googleapis.com/${bucket.name}/${file.name}`);
    });

    stream.end(fileBuffer);
  });
};

/**
 * Processes and uploads a product image in 3 sizes: thumb, medium, original (WebP)
 */
const processAndUploadProductImage = async (fileBuffer, originalName, productId) => {
  const timestamp = Date.now();
  // Using the blueprint folder structure
  const folder = `products/${productId}/${timestamp}`;

  const sizes = [
    { name: 'thumb', width: 200, height: 200 },
    { name: 'medium', width: 600, height: 600 },
    { name: 'original', width: null, height: null }
  ];

  const uploadPromises = sizes.map(async (size) => {
    let processedBuffer;

    if (size.width) {
      // Resize for thumb and medium
      processedBuffer = await sharp(fileBuffer)
        .resize(size.width, size.height, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();
    } else {
      // Just convert to WebP for original
      processedBuffer = await sharp(fileBuffer)
        .webp({ quality: 90 })
        .toBuffer();
    }

    const destination = `${folder}/${size.name}.webp`;
    return uploadToGCS(processedBuffer, destination, 'image/webp');
  });

  const [thumb, medium, original] = await Promise.all(uploadPromises);

  return { thumb, medium, original };
};

/**
 * Deletes a file from Google Cloud Storage
 */
const deleteFromGCS = async (fileUrl) => {
  try {
    if (!bucket) return;
    const fileName = fileUrl.split(`${bucket.name}/`)[1];
    if (fileName) {
      await bucket.file(fileName).delete();
    }
  } catch (err) {
    console.error('Failed to delete file from GCS:', err);
  }
};

module.exports = {
  uploadToGCS,
  processAndUploadProductImage,
  deleteFromGCS,
};
