require('dotenv').config({ path: __dirname + '/.env' });
const { Storage } = require('@google-cloud/storage');
const path = require('path');

async function checkBucket() {
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
  
  try {
    const [files] = await bucket.getFiles({ prefix: 'products/' });
    
    // Group files by product folder
    const productFolders = {};
    files.forEach(file => {
      const parts = file.name.split('/');
      if (parts.length >= 3) {
        // products / productId / timestamp / file
        const productId = parts[1];
        const timestamp = parts[2];
        const folderKey = `products/${productId}/${timestamp}`;
        if (!productFolders[folderKey]) {
          productFolders[folderKey] = [];
        }
        productFolders[folderKey].push(file.name);
      } else if (parts.length === 2) {
         const productId = parts[1];
         if (!productFolders[productId]) productFolders[productId] = [];
         productFolders[productId].push(file.name);
      }
    });

    console.log(`Found ${Object.keys(productFolders).length} product folders.`);
    
    // Print out the folders and their file count to see which ones have < 3 images
    Object.keys(productFolders).forEach(folder => {
      console.log(`Folder: ${folder} - Files: ${productFolders[folder].length}`);
      if (productFolders[folder].length < 3) {
         console.log(`  -> ${productFolders[folder].join(', ')}`);
      }
    });

  } catch (error) {
    console.error("Error accessing bucket:", error);
  }
}

checkBucket();
