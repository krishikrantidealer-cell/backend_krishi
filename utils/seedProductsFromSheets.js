require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Collection = require('../models/Collection');

const MONGO_URI = process.env.MONGODB_URI;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=1233824187';

function getMultiplier(sizeStr) {
  const clean = sizeStr.toLowerCase().replace(/\s+/g, '');

  // Match number followed by unit (ml, lit, litre, l, gm, gram, g, kg, kilogram, k)
  const match = clean.match(/^([\d.]+)(ml|lit|litre|l|gm|gram|g|kg|kilogram|k)$/);
  if (!match) return 1.0;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (unit === 'ml' || unit === 'gm' || unit === 'gram' || unit === 'g') {
    return value / 1000.0;
  }
  return value; // litre, kg, etc. has multiplier = value
}

function guessCategory(catStr, title = '', body = '') {
  const s = (catStr || '').trim().toLowerCase();

  // 1. Check the explicit Category column first
  if (s.includes('herbicide')) return 'Herbicides';
  if (s.includes('insecticide')) return 'Insecticides';
  if (s.includes('fungicide')) return 'Fungicides';
  if (s.includes('fertilizer')) return 'Fertilizers';
  if (s.includes('pgr') || s.includes('growth')) return 'PGRs';
  if (s.includes('bio')) return 'Bio-Products';

  // 2. If the sheet is ambiguous (TBD/Empty), guess from the title and body
  const combined = `${title} ${body}`.toLowerCase();
  if (combined.includes('herbicide')) return 'Herbicides';
  if (combined.includes('insecticide')) return 'Insecticides';
  if (combined.includes('fungicide')) return 'Fungicides';
  if (combined.includes('fertilizer')) return 'Fertilizers';
  if (combined.includes('pgr') || combined.includes('growth')) return 'PGRs';
  if (combined.includes('bio')) return 'Bio-Products';

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
    // We don't delete Collections here to preserve manually created ones
    console.log('Old product and category data cleared.');

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

        const keys = Object.keys(cleanRow);
        const firstKey = keys[0];
        // Support flexible brand name columns (Product Brand Name, "7", or the very first column)
        const brandNameRaw = cleanRow['Product Brand Name'] || cleanRow['7'] || (firstKey ? cleanRow[firstKey] : '');
        const brandName = brandNameRaw ? brandNameRaw.trim() : '';
        const technicalName = cleanRow['Product Technical Name'] ? cleanRow['Product Technical Name'].trim() : '';

        // Support Product Complete Title or Product Title
        const productTitle = cleanRow['Product Complete Title'] || cleanRow['Product Title'] || brandName;

        // Parse Rating & Reviews dynamically
        const ratingRaw = cleanRow['Rating'] || cleanRow['Product Rating'] || cleanRow['Average Rating'] || cleanRow['averageRating'] || '';
        const averageRating = ratingRaw ? parseFloat(ratingRaw) || 0 : 0;

        const reviewsRaw = cleanRow['Reviews'] || cleanRow['No. of Reviews'] || cleanRow['Number of Reviews'] || cleanRow['numReviews'] || cleanRow['Review Count'] || '';
        const numReviews = reviewsRaw ? parseInt(reviewsRaw, 10) || 0 : 0;

        // If brandName is present, it's a new product row
        if (brandName && brandName !== 'Product Brand Name' && brandName !== 'Product Brand Name') {
          currentProduct = {
            brandName: brandName,
            technicalName: technicalName,
            title: productTitle,
            description: cleanRow['Product Body'] || '',
            vendor: cleanRow['Vendor'] || 'Krishikranti',
            _tempCategoryName: guessCategory(
              cleanRow['Category'],
              productTitle,
              cleanRow['Product Body'] || ''
            ),
            _tempSubCategoryName: cleanRow['Sub-Category'] || 'Chemical',
            images: cleanRow['Product Image'] ? [cleanRow['Product Image'].trim()] : [],
            thumbnail: cleanRow['Product Image'] ? cleanRow['Product Image'].trim() : '',
            variants: [],
            availabilityStatus: cleanRow['Availability'] || 'In Stock',
            assignedCollections: cleanRow['Assigned Collections'] ? cleanRow['Assigned Collections'].split(',').map(c => c.trim()).filter(Boolean) : [],
            isFeatured: (cleanRow['Featured Product'] || '').toLowerCase() === 'yes',
            averageRating: averageRating,
            numReviews: numReviews
          };
          productsArray.push(currentProduct);
        }

        // Add variants from the same row or subsequent rows if they don't have a brand name
        if (currentProduct) {
          const size = cleanRow['Packing Sizes'] ? cleanRow['Packing Sizes'].trim() : '';
          if (size && size !== 'Packing Sizes') {
            const keys = Object.keys(cleanRow);
            const v1Key = keys.find(k => k.includes('Variant 1 (Selling Price)'));
            const v2Key = keys.find(k => k.includes('Variant 2 (Selling Price)'));
            const v3Key = keys.find(k => k.includes('Variant 3 (Selling Price)'));
            const mrpKey = keys.find(k => k.includes('Variant (MRP)'));

            const v1Str = v1Key ? cleanRow[v1Key] : '';
            const v2Str = v2Key ? cleanRow[v2Key] : '';
            const v3Str = v3Key ? cleanRow[v3Key] : '';
            const mrpStr = mrpKey ? cleanRow[mrpKey] : '';

            const v1Match = v1Str ? v1Str.match(/[\d.]+/) : null;
            const v2Match = v2Str ? v2Str.match(/[\d.]+/) : null;
            const v3Match = v3Str ? v3Str.match(/[\d.]+/) : null;
            const mrpMatch = mrpStr ? mrpStr.match(/[\d.]+/) : null;

            const v1Price = v1Match ? parseFloat(v1Match[0]) : 0;
            // Fallback tiers if subsequent are empty
            const v2Price = v2Match ? parseFloat(v2Match[0]) : v1Price;
            const v3Price = v3Match ? parseFloat(v3Match[0]) : v2Price;
            const mrpPrice = mrpMatch ? parseFloat(mrpMatch[0]) : 0;

            if (v1Price > 0) {
              // Parse packVolume from Base Packing column, fallback to multiplier of pack size
              const basePackingStr = cleanRow['Base Packing'] ? cleanRow['Base Packing'].trim() : '';
              const packVolume = basePackingStr ? getMultiplier(basePackingStr) : getMultiplier(size);

              // Use direct parsed sheet prices (do not multiply by getMultiplier(size))
              const price10_30 = parseFloat(v1Price.toFixed(2));
              const price30_50 = parseFloat(v2Price.toFixed(2));
              const price50_plus = parseFloat(v3Price.toFixed(2));
              const price = price10_30; // default baseline price
              
              // Compare At Price / MRP
              const compareAtPrice = mrpPrice > 0 ? parseFloat(mrpPrice.toFixed(2)) : undefined;

              currentProduct.variants.push({
                size: size, // Clean variant size e.g. "100ml" (no trailing parentheses)
                price: price,
                compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : undefined,
                price10_30: price10_30,
                price30_50: price30_50,
                price50_plus: price50_plus,
                packVolume: packVolume
              });
            }
          }
        }
      })
      .on('end', async () => {
        console.log('Finished parsing Google Sheet data.');

        // Extract and create unique collections
        const uniqueCollectionNames = new Set();
        productsArray.forEach(p => {
          if (p.assignedCollections) {
            p.assignedCollections.forEach(c => uniqueCollectionNames.add(c));
          }
        });

        console.log(`Checking/Creating ${uniqueCollectionNames.size} collections...`);
        for (const name of uniqueCollectionNames) {
          if (!name || !name.trim()) continue;
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          if (!slug) continue;
          const existing = await Collection.findOne({ slug });
          if (!existing) {
            await Collection.create({
              name,
              slug,
              isActive: true,
              priority: 0
            });
            console.log(`Created new collection: ${name}`);
          }
        }

        // Ensure all products have at least one variant so they aren't lost
        productsArray.forEach(p => {
          if (p.variants.length === 0) {
            p.variants.push({
              size: 'Standard',
              price: 0,
              stock: 10
            });
          }
        });

        const finalProducts = productsArray;
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

          // Calculate minPrice and maxPrice manually because insertMany bypasses save middleware
          if (product.variants && product.variants.length > 0) {
            const prices = product.variants.map(v => v.price);
            product.minPrice = Math.min(...prices);
            product.maxPrice = Math.max(...prices);
          } else {
            product.minPrice = 0;
            product.maxPrice = 0;
          }
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
