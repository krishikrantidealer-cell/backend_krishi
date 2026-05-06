require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const Product = require('./models/Product');
const connectDB = require('./config/db');
const { processAndUploadProductImage } = require('./utils/gcs');
const axios = require('axios');

async function fixLatestProducts() {
  await connectDB();
  
  // Find the latest 2 GLYUP products
  const products = await Product.find({ title: /GLYUP/i })
    .sort({ _id: -1 })
    .limit(2);

  if (products.length === 0) {
    console.log("No GLYUP products found.");
    process.exit(0);
  }

  for (const product of products) {
    console.log(`Fixing product: ${product._id}`);
    
    // Extract Google Drive ID
    const match = product.thumbnail.match(/d\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      console.log(`No valid drive ID found for ${product.thumbnail}`);
      continue;
    }
    
    const fileId = match[1];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    console.log(`Downloading image from Drive...`);
    try {
      const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data, 'binary');
      
      console.log(`Uploading to GCS...`);
      const { thumb, medium, original } = await processAndUploadProductImage(buffer, 'glyup.jpg', product._id.toString());
      
      console.log(`Updating database...`);
      product.thumbnail = thumb;
      product.mediumImages = [medium];
      product.originalImages = [original];
      product.images = [thumb]; // Legacy
      
      await product.save();
      console.log(`Product ${product._id} fixed successfully!`);
    } catch (e) {
      console.error(`Error processing ${product._id}:`, e.message);
    }
  }

  process.exit(0);
}

fixLatestProducts();
