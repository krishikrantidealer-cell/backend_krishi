const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  const { bucket } = require('./utils/gcs');
  if (!bucket) {
    throw new Error("No GCS bucket configured. Check GCS_BUCKET_NAME env var.");
  }
  const [files] = await bucket.getFiles({ prefix: 'customcollectionsbanners/' });

  console.log(`Found ${files.length} files under customcollectionsbanners/:`);
  for (const f of files) {
    console.log(`- ${f.name}`);
  }
  process.exit(0);
}

main().catch(console.error);
