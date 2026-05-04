require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const collectionController = require('./controllers/collection.controller');

async function testControllerDirectly() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    // Mock req, res, next
    const req = { query: { productLimit: 5, skipEmpty: 'false' } };
    const res = {
      json: (data) => {
        console.log('API Response Success:', data.success);
        console.log('Collections count:', data.collections.length);
        data.collections.forEach(c => {
          console.log(`- Collection: ${c.name} | Products: ${c.products.length}`);
        });
        process.exit(0);
      }
    };
    const next = (err) => {
      console.error('Controller Error:', err);
      process.exit(1);
    };

    await collectionController.getCollectionsWithProducts(req, res, next);
  } catch (error) {
    console.error('Test Error:', error);
    process.exit(1);
  }
}

testControllerDirectly();
