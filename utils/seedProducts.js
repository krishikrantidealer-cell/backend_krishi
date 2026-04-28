require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');

const MONGO_URI = process.env.MONGODB_URI;

function guessCategory(catStr) {
  const str = (catStr || '').toLowerCase();
  if (str.includes('insecticide')) return 'Insecticides';
  if (str.includes('fungicide')) return 'Fungicides';
  if (str.includes('fertilizer')) return 'Fertilizers';
  if (str.includes('pgr') || str.includes('growth')) return 'PGRs';
  if (str.includes('bio')) return 'Bio-Products';
  if (str.includes('herbicide')) return 'Herbicides';
  return 'Fertilizers';
}

async function seedData() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    console.log('Clearing old products and categories from the database...');
    await Product.deleteMany({});
    await Category.deleteMany({});
    console.log('Old products and categories cleared.');

    const csvFilePath = path.join(__dirname, 'products_sheets.csv');
    console.log('Reading Google Sheets CSV file...');

    let currentProduct = null;
    const productsArray = [];

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const brandNameKey = Object.keys(row).find(k => k.trim() === 'Product Brand Name');
        const brandName = row[brandNameKey] ? row[brandNameKey].trim() : '';

        if (brandName === 'Product Brand Name') return;

        if (brandName !== '') {
          const titleKey = Object.keys(row).find(k => k.trim() === 'Product Title');
          const bodyKey = Object.keys(row).find(k => k.trim() === 'Product Body');
          const imageKey = Object.keys(row).find(k => k.trim() === 'Product Image');
          const vendorKey = Object.keys(row).find(k => k.trim() === 'Vendor');
          const catKey = Object.keys(row).find(k => k.trim() === 'Category');
          const subCatKey = Object.keys(row).find(k => k.trim() === 'Sub-Category');
          const availKey = Object.keys(row).find(k => k.trim() === 'Availability');

          currentProduct = {
            title: row[titleKey] || brandName,
            body: row[bodyKey] || '',
            vendor: row[vendorKey] || 'Krishikranti',
            // Temporary string fields to be mapped to ObjectIds later
            _tempCategoryName: guessCategory(row[catKey]),
            _tempSubCategoryName: row[subCatKey] || 'Chemical',
            images: row[imageKey] ? [row[imageKey].trim()] : [],
            variants: [],
            availabilityStatus: row[availKey] || 'In Stock'
          };
          productsArray.push(currentProduct);
        }

        if (currentProduct) {
          const sizeKey = Object.keys(row).find(k => k.trim() === 'Packing Sizes');
          const size = row[sizeKey] ? row[sizeKey].trim() : '';

          if (size !== '' && size !== 'Packing Sizes') {
            const keys = Object.keys(row);
            const sellingPriceKey = keys.find(k => k.includes('Variant 1') && k.toLowerCase().includes('selling'));
            const mrpKey = keys.find(k => k.includes('Variant 1') && k.toLowerCase().includes('mrp'));

            const priceStr = sellingPriceKey ? row[sellingPriceKey] : '';
            const mrpStr = mrpKey ? row[mrpKey] : '';

            const priceMatch = priceStr.match(/[\d.]+/);
            const mrpMatch = mrpStr.match(/[\d.]+/);

            const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
            const compareAtPrice = mrpMatch ? parseFloat(mrpMatch[0]) : 0;

            if (price > 0) {
              currentProduct.variants.push({
                size: size,
                price: price,
                compareAtPrice: compareAtPrice > price ? compareAtPrice : undefined
              });
            }
          }
        }
      })
      .on('end', async () => {
        console.log('CSV Parsing finished.');
        const validProducts = productsArray.filter(p => p.variants.length > 0);
        console.log(`Found ${validProducts.length} unique products with variants.`);

        if (validProducts.length === 0) {
           console.log('No products found to insert. Exiting.');
           process.exit(0);
        }

        console.log('Generating Categories and mapping ObjectIds...');
        
        // Map to keep track of categories so we don't query the DB unnecessarily
        const categoryMap = {};

        for (const product of validProducts) {
           const catName = product._tempCategoryName;
           const subCatName = product._tempSubCategoryName;

           // 1. Get or Create Category
           if (!categoryMap[catName]) {
             let dbCat = await Category.findOne({ name: catName });
             if (!dbCat) {
               dbCat = await Category.create({ name: catName, subCategories: [] });
             }
             categoryMap[catName] = dbCat;
           }

           const category = categoryMap[catName];

           // 2. Get or Create SubCategory
           let subCategory = category.subCategories.find(s => s.name === subCatName);
           if (!subCategory) {
             category.subCategories.push({ name: subCatName });
             await category.save();
             subCategory = category.subCategories.find(s => s.name === subCatName);
           }

           // 3. Assign ObjectIds to the Product
           product.categoryId = category._id;
           product.subCategoryId = subCategory._id;

           // Remove temporary fields
           delete product._tempCategoryName;
           delete product._tempSubCategoryName;
        }

        console.log('Inserting into MongoDB... This may take a minute.');

        try {
          await Product.insertMany(validProducts, { ordered: false });
          console.log('✅ Seeding completed successfully!');
        } catch (err) {
          if (err.code === 11000 || err.name === 'BulkWriteError') {
            console.log('Some validation issues occurred, but valid products were inserted.');
          } else {
            console.error('Error inserting:', err.message);
          }
        }
        process.exit(0);
      });

  } catch (error) {
    console.error('❌ Failed to seed data:', error);
    process.exit(1);
  }
}

seedData();
