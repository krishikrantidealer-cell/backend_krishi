require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function findUnknownCollections() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const products = await Product.find().select('assignedCollections');
    const unknown = new Set();
    const known = ['Paddy', 'Wheat', 'Maize', 'Soybean', 'Sugarcane', 'Cotton'];
    
    products.forEach(p => {
      p.assignedCollections.forEach(c => {
        if (!known.includes(c)) unknown.add(c);
      });
    });
    
    console.log('Unknown Collections in Products:');
    unknown.forEach(c => console.log(`- ${c}`));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

findUnknownCollections();
