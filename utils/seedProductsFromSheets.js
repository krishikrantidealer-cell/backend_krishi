require('dotenv').config();
const axios = require('axios');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');

const MONGO_URI = process.env.MONGODB_URI;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

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

    console.log('Clearing old products and categories...');
    await Product.deleteMany({});
    await Category.deleteMany({});
    console.log('Old data cleared.');

    console.log('Fetching data from Google Sheets...');
    const response = await axios.get(SHEET_URL, { responseType: 'stream' });

    const productsArray = [];
    let currentProduct = null;

    response.data
      .pipe(csv())
      .on('data', (row) => {
        // Clean keys
        const cleanRow = {};
        Object.keys(row).forEach(key => {
          cleanRow[key.trim()] = row[key];
        });

        const brandName = cleanRow['Product Brand Name'] ? cleanRow['Product Brand Name'].trim() : '';
        const technicalName = cleanRow['Product Technical Name'] ? cleanRow['Product Technical Name'].trim() : '';

        // If brandName is present, it's a new product row
        if (brandName && brandName !== 'Product Brand Name') {
          currentProduct = {
            brandName: brandName,
            technicalName: technicalName,
            title: cleanRow['Product Title'] || brandName,
            body: cleanRow['Product Body'] || '',
            vendor: cleanRow['Vendor'] || 'Krishikranti',
            _tempCategoryName: guessCategory(cleanRow['Category']),
            _tempSubCategoryName: cleanRow['Sub-Category'] || 'Chemical',
            images: cleanRow['Product Image'] ? [cleanRow['Product Image'].trim()] : [],
            variants: [],
            availabilityStatus: cleanRow['Availability'] || 'In Stock'
          };
          productsArray.push(currentProduct);
        }

        // Add variants from the same row or subsequent rows if they don't have a brand name
        if (currentProduct) {
          const size = cleanRow['Packing Sizes'] ? cleanRow['Packing Sizes'].trim() : '';
          if (size && size !== 'Packing Sizes') {
            const keys = Object.keys(cleanRow);

            // Check all potential variants (1 to 4)
            for (let i = 1; i <= 4; i++) {
              const sellingPriceKey = keys.find(k => k.includes(`Variant ${i}`) && k.toLowerCase().includes('selling'));
              const mrpKey = keys.find(k => k.includes(`Variant ${i}`) && k.toLowerCase().includes('mrp'));

              if (sellingPriceKey) {
                const priceStr = cleanRow[sellingPriceKey] || '';
                const mrpStr = mrpKey ? cleanRow[mrpKey] : '';

                const priceMatch = priceStr.match(/[\d.]+/);
                const mrpMatch = mrpStr.match(/[\d.]+/);

                const price = priceMatch ? parseFloat(priceMatch[0]) : 0;
                const compareAtPrice = mrpMatch ? parseFloat(mrpMatch[0]) : 0;

                if (price > 0) {
                  // We need to associate the size correctly. 
                  // In this sheet, it seems each row has one 'Packing Size' and then multiple 'Variant X' columns?
                  // Wait, looking at the header: 'Packing Sizes', 'Variant 1 (Selling Price) 10litre', 'Variant 1 (MRP)'
                  // It seems 'Packing Sizes' column might be redundant if the variant column itself has the size?
                  // Or maybe Variant 1 always corresponds to the first size, Variant 2 to the second?
                  // Let's assume for now that if multiple variants exist in one row, they might use the same size or different ones.
                  // But usually, one row = one size, and then different price tiers? No, that doesn't make sense.
                  // Most likely: One row can have multiple variants (sizes/prices).

                  // Let's try to extract size from the header if possible
                  let variantSize = size;
                  const sizeInHeaderMatch = sellingPriceKey.match(/\d+\s*(?:litre|ml|kg|gm|gram|packet)/i);
                  if (sizeInHeaderMatch) {
                    variantSize = sizeInHeaderMatch[0];
                  }

                  currentProduct.variants.push({
                    size: variantSize,
                    price: price,
                    compareAtPrice: compareAtPrice > price ? compareAtPrice : undefined
                  });
                }
              }
            }
          }
        }
      })
      .on('end', async () => {
        console.log('Finished parsing Google Sheet data.');

        // Remove products with no variants
        const finalProducts = productsArray.filter(p => p.variants.length > 0);
        console.log(`Processing ${finalProducts.length} products...`);

        const categoryMap = {};

        for (const product of finalProducts) {
          const catName = product._tempCategoryName;
          const subCatName = product._tempSubCategoryName;

          if (!categoryMap[catName]) {
            let dbCat = await Category.findOne({ name: catName });
            if (!dbCat) {
              dbCat = await Category.create({ name: catName, subCategories: [] });
            }
            categoryMap[catName] = dbCat;
          }

          const category = categoryMap[catName];
          let subCategory = category.subCategories.find(s => s.name === subCatName);
          if (!subCategory) {
            category.subCategories.push({ name: subCatName });
            await category.save();
            subCategory = category.subCategories.find(s => s.name === subCatName);
          }

          product.categoryId = category._id;
          product.subCategoryId = subCategory._id;

          delete product._tempCategoryName;
          delete product._tempSubCategoryName;
        }

        console.log('Inserting products into database...');
        try {
          await Product.insertMany(finalProducts, { ordered: false });
          console.log('✅ Seeding from Google Sheets completed successfully!');
        } catch (err) {
          console.error('Error during insertion:', err.message);
        }
        process.exit(0);
      });

  } catch (error) {
    console.error('❌ Failed to seed data from Google Sheets:', error);
    process.exit(1);
  }
}

seedData();
