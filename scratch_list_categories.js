require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const Category = require('./models/Category');

async function listCategories() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const categories = await Category.find();
    console.log('Categories in DB:');
    categories.forEach(c => console.log(`- ${c.name} (${c._id})`));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

listCategories();
