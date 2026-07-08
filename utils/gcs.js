const { Storage } = require('@google-cloud/storage');
const path = require('path');
const sharp = require('sharp');
const dotenv = require('dotenv');

// Disable sharp cache to prevent memory leaks and OOM in memory-constrained environments like Cloud Run
sharp.cache(false);

dotenv.config({ path: path.join(__dirname, '../.env') });

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
} else if (process.env.NODE_ENV !== 'production') {
  // Option B: Load from File (ONLY for Local Development)
  try {
    let keyPath = process.env.GCS_KEY_FILE_PATH || './config/gcs-key.json';
    if (!path.isAbsolute(keyPath)) {
      // Resolve relative to the backend root (which is one directory up from utils/)
      keyPath = path.join(__dirname, '..', keyPath);
    }
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID || 'placeholder',
      keyFilename: keyPath,
    });
  } catch (err) {
    console.error('Local GCS Key file not found:', err.message);
  }
} else {
  // Option C: Native GCP Environment (Cloud Run / GAE) - uses IAM service account roles automatically
  try {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID
    });
  } catch (err) {
    console.error('Failed to initialize Storage with application default credentials:', err.message);
  }
}

// Safety check to prevent crash on startup if ENV is not set yet
const bucketName = process.env.GCS_BUCKET_NAME;
const bucket = (storage && bucketName) ? storage.bucket(bucketName) : null;

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
        .resize(size.width, size.height, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
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
 * Processes and uploads a KYC document (licence/identity).
 * Handles images with Sharp (conversion to WebP) and uploads other documents (PDF, etc.) as-is.
 */
const processAndUploadKycDocument = async (fileBuffer, originalName, userId) => {
  try {
    const timestamp = Date.now();
    const folder = `kyc/${userId}`;
    const extension = path.extname(originalName).toLowerCase();
    const baseName = path.basename(originalName, extension).replace(/[^a-z0-9]/gi, '_').toLowerCase();

    // List of image extensions that Sharp can process
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff'];

    if (imageExtensions.includes(extension)) {
      try {
        const processedBuffer = await sharp(fileBuffer)
          .webp({ quality: 85 })
          .toBuffer();

        const destination = `${folder}/${baseName}_${timestamp}.webp`;
        return uploadToGCS(processedBuffer, destination, 'image/webp');
      } catch (sharpError) {
        console.error(`[Sharp] Failed to process image ${originalName}:`, sharpError.message);
        // Fallback: upload original file if Sharp fails
        const destination = `${folder}/${baseName}_${timestamp}${extension}`;
        return uploadToGCS(fileBuffer, destination, getMimeTypeFromExt(extension));
      }
    } else {
      // For PDF, Word, or other non-image documents, upload as-is
      const destination = `${folder}/${baseName}_${timestamp}${extension}`;
      return uploadToGCS(fileBuffer, destination, getMimeTypeFromExt(extension));
    }
  } catch (err) {
    console.error(`[GCS] Error in processAndUploadKycDocument for ${originalName}:`, err.message);
    throw err;
  }
};

/**
 * Helper to determine MIME type from extension since mime-types package might not be available
 */
const getMimeTypeFromExt = (ext) => {
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.txt': 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
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

/**
 * Generates a signed URL for uploading a file directly to GCS
 */
const getSignedUploadUrl = async (destination, contentType) => {
  if (!bucket) {
    throw new Error('GCS Bucket is not configured. Please check your .env file.');
  }

  const [url] = await bucket.file(destination).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    contentType: contentType,
  });

  return {
    uploadUrl: url,
    publicUrl: `https://storage.googleapis.com/${bucket.name}/${destination}`
  };
};

module.exports = {
  storage,
  bucket,
  uploadToGCS,
  processAndUploadProductImage,
  processAndUploadKycDocument,
  deleteFromGCS,
  getSignedUploadUrl,
};
