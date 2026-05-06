require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const Banner = require('./models/Banner');

async function addBioBanner() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB.');

    const exists = await Banner.findOne({
      type: 'category_card',
      imageUrl: 'https://storage.googleapis.com/krishi-product-images/categorycardbanners/Bio-Products.webp'
    });

    if (exists) {
      console.log('Bio-Products category card banner already exists in DB:', exists);
    } else {
      console.log('Adding Bio-Products category card banner to DB...');
      const bioBanner = new Banner({
        title: 'Category Card Banner 7',
        type: 'category_card',
        imageUrl: 'https://storage.googleapis.com/krishi-product-images/categorycardbanners/Bio-Products.webp',
        priority: 7,
        isActive: true,
        redirectType: 'category',
        redirectTarget: 'Bio-Products'
      });

      await bioBanner.save();
      console.log('Successfully added Bio-Products category card banner!');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error adding bio banner:', error);
    process.exit(1);
  }
}

addBioBanner();
