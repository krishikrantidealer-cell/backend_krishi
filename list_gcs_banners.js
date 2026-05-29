const { Storage } = require('@google-cloud/storage');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  let storage;
  if (process.env.GCS_KEY_JSON) {
    storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      credentials: JSON.parse(process.env.GCS_KEY_JSON)
    });
  } else {
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
  const bucket = storage.bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: 'customcollectionsbanners/' });

  console.log(`Found ${files.length} files under customcollectionsbanners/:`);
  for (const f of files) {
    console.log(`- ${f.name}`);
  }
  process.exit(0);
}

main().catch(console.error);
