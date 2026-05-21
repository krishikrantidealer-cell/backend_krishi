require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function listProducts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const products = await Product.find({}).limit(5);
    for (const p of products) {
      console.log(`Product: ${p.title}`);
      console.log(`- Thumbnail: ${p.thumbnail}`);
      console.log(`- Images: ${JSON.stringify(p.images)}`);
      console.log(`- OriginalImages: ${JSON.stringify(p.originalImages)}`);
      console.log(`- MediumImages: ${JSON.stringify(p.mediumImages)}`);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

listProducts();
