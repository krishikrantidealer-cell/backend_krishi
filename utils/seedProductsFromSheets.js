require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const axios = require('axios');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Collection = require('../models/Collection');

const MONGO_URI = process.env.MONGODB_URI;
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/15XLeb_EkYW6Mn0Vohj9RxTMoXyWk8aLk2IMJg9tTJnU/export?format=csv&gid=0';

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

        const brandName = cleanRow['Product Brand Name'] ? cleanRow['Product Brand Name'].trim() : '';
        const technicalName = cleanRow['Product Technical Name'] ? cleanRow['Product Technical Name'].trim() : '';

        // If brandName is present, it's a new product row
        if (brandName && brandName !== 'Product Brand Name') {
          currentProduct = {
            brandName: brandName,
            technicalName: technicalName,
            title: cleanRow['Product Title'] || brandName,
            description: cleanRow['Product Body'] || '',
            vendor: cleanRow['Vendor'] || 'Krishikranti',
            _tempCategoryName: guessCategory(
              cleanRow['Category'],
              cleanRow['Product Title'] || brandName,
              cleanRow['Product Body'] || ''
            ),
            _tempSubCategoryName: cleanRow['Sub-Category'] || 'Chemical',
            images: cleanRow['Product Image'] ? [cleanRow['Product Image'].trim()] : [],
            thumbnail: cleanRow['Product Image'] ? cleanRow['Product Image'].trim() : '',
            variants: [],
            availabilityStatus: cleanRow['Availability'] || 'In Stock',
            assignedCollections: cleanRow['Assigned Collections'] ? cleanRow['Assigned Collections'].split(',').map(c => c.trim()) : [],
            isFeatured: (cleanRow['Featured Product'] || '').toLowerCase() === 'yes'
          };
          productsArray.push(currentProduct);
        }

        // Add variants from the same row or subsequent rows if they don't have a brand name
        if (currentProduct) {
          const size = cleanRow['Packing Sizes'] ? cleanRow['Packing Sizes'].trim() : '';
          if (size && size !== 'Packing Sizes') {
            const keys = Object.keys(cleanRow);
            const sellingPriceKey = keys.find(k => k.trim().includes('Variant (Selling Price)'));
            const mrpKey = keys.find(k => k.trim().includes('Variant (MRP)'));

            if (sellingPriceKey) {
              const priceStr = cleanRow[sellingPriceKey] || '';
              const mrpStr = mrpKey ? cleanRow[mrpKey] : '';

              const priceMatch = priceStr.match(/[\d.]+/);
              const mrpMatch = mrpStr.match(/[\d.]+/);

              const rawPrice = priceMatch ? parseFloat(priceMatch[0]) : 0;
              const rawCompareAtPrice = mrpMatch ? parseFloat(mrpMatch[0]) : 0;

              if (rawPrice > 0) {
                // 1. Extract the tier description from the header (e.g. "10litre", "10kg")
                let tierName = '';
                const tierNumMatch = sellingPriceKey.match(/(\d+)\s*(?:Litre|Kg)/i);
                const tierNum = tierNumMatch ? tierNumMatch[1] : '10';

                const isSolid = /kg|gm|gram|g/i.test(priceStr) || /gm|gram|g|kg/i.test(size);
                if (isSolid) {
                  tierName = `${tierNum}kg`;
                } else {
                  tierName = `${tierNum}litre`;
                }

                // 2. Compose a unique size representation: "100ml (10litre)"
                const variantSize = tierName ? `${size} (${tierName})` : size;

                const calculatedPrice = rawPrice;
                const calculatedCompareAtPrice = rawCompareAtPrice > 0 ? rawCompareAtPrice : undefined;

                currentProduct.variants.push({
                  size: variantSize,
                  price: calculatedPrice,
                  compareAtPrice: calculatedCompareAtPrice && calculatedCompareAtPrice > calculatedPrice
                    ? calculatedCompareAtPrice
                    : undefined
                });
              }
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
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          const existing = await Collection.findOne({ name });
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
