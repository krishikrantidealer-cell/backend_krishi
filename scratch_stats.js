require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Category = require('./models/Category');
const Product = require('./models/Product');

async function stats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const categories = await Category.find();
    for (const cat of categories) {
      const count = await Product.countDocuments({ categoryId: cat._id });
      console.log(`${cat.name}: ${count} products`);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

stats();
