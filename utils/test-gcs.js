const { Storage } = require('@google-cloud/storage');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

async function testGCS() {
  console.log('🚀 Starting GCS Connectivity Test...');
  console.log('Project ID:', process.env.GCS_PROJECT_ID);
  console.log('Bucket Name:', process.env.GCS_BUCKET_NAME);
  console.log('Key File Path:', process.env.GCS_KEY_FILE_PATH);

  const keyPath = path.resolve(process.env.GCS_KEY_FILE_PATH);
  if (!fs.existsSync(keyPath)) {
    console.error('❌ Error: Key file not found at', keyPath);
    return;
  }

  try {
    const storage = new Storage({
      projectId: process.env.GCS_PROJECT_ID,
      keyFilename: keyPath,
    });

    const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

    console.log('⏳ Checking bucket metadata...');
    const [metadata] = await bucket.getMetadata();

    console.log('✅ Success! Connected to bucket:', metadata.name);
    console.log('📍 Location:', metadata.location);
    console.log('☁️ Storage Class:', metadata.storageClass);
    console.log('\nYour GCS setup is READY for production image processing.');

  } catch (error) {
    console.error('❌ Connectivity Failed!');
    console.error('Error details:', error.message);
    if (error.message.includes('Does not have storage.buckets.get access')) {
      console.log('\n💡 Tip: Make sure your Service Account has the "Storage Object Admin" or "Storage Admin" role.');
    }
  }
}

testGCS();
