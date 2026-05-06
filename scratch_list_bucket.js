require('dotenv').config({ path: __dirname + '/.env' });
const { Storage } = require('@google-cloud/storage');

async function checkBucket() {
  let storage;
  if (process.env.GCS_KEY_JSON) {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: JSON.parse(process.env.GCS_KEY_JSON)
    });
  } else {
    const path = require('path');
    let keyPath = process.env.GCS_KEY_FILE_PATH || './config/gcs-key.json';
    if (!path.isAbsolute(keyPath)) {
      keyPath = path.join(__dirname, keyPath);
    }
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      keyFilename: keyPath,
    });
  }

  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    console.log("No GCS_BUCKET_NAME found in .env");
    return;
  }

  const bucket = storage.bucket(bucketName);
  
  try {
    const [files] = await bucket.getFiles();
    console.log(`Found ${files.length} total files in bucket.`);
    files.forEach(file => {
      if (file.name.includes('banner')) {
        console.log(`- ${file.name}`);
      }
    });
  } catch (error) {
    console.error("Error accessing bucket:", error.message);
  }
}

checkBucket();
