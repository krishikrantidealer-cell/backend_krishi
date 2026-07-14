require('dotenv').config({ path: '/Users/krishikranti/office_work/backend_krishi/.env' });
const mongoose = require('mongoose');
const Product = require('../models/Product');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI found in environment!');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('Connected successfully.');

  console.log('Fetching all products sorted by current order and _id...');
  const products = await Product.find({}).sort({ order: 1, _id: 1 });
  console.log(`Found ${products.length} products.`);

  const categoryCounters = {};
  const subCategoryCounters = {};
  const collectionCounters = {};

  const bulkOps = [];

  for (const p of products) {
    const customOrders = {};

    // 1. Categories
    const catIds = [];
    if (p.categoryId) catIds.push(p.categoryId.toString());
    if (p.categoryIds && Array.isArray(p.categoryIds)) {
      p.categoryIds.forEach(id => {
        if (id) catIds.push(id.toString());
      });
    }
    const uniqueCatIds = [...new Set(catIds)];
    for (const catId of uniqueCatIds) {
      if (categoryCounters[catId] === undefined) {
        categoryCounters[catId] = 0;
      }
      customOrders[catId] = categoryCounters[catId]++;
    }

    // 2. Subcategories
    const subCatIds = [];
    if (p.subCategoryId) subCatIds.push(p.subCategoryId.toString());
    if (p.subCategoryIds && Array.isArray(p.subCategoryIds)) {
      p.subCategoryIds.forEach(id => {
        if (id) subCatIds.push(id.toString());
      });
    }
    const uniqueSubCatIds = [...new Set(subCatIds)];
    for (const subCatId of uniqueSubCatIds) {
      if (subCategoryCounters[subCatId] === undefined) {
        subCategoryCounters[subCatId] = 0;
      }
      customOrders[subCatId] = subCategoryCounters[subCatId]++;
    }

    // 3. Collections
    if (p.assignedCollections && Array.isArray(p.assignedCollections)) {
      for (const col of p.assignedCollections) {
        if (col && typeof col === 'string') {
          if (collectionCounters[col] === undefined) {
            collectionCounters[col] = 0;
          }
          customOrders[col] = collectionCounters[col]++;
        }
      }
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: p._id },
        update: { $set: { customOrders } }
      }
    });
  }

  if (bulkOps.length > 0) {
    console.log(`Executing bulk update for ${bulkOps.length} products...`);
    const result = await Product.bulkWrite(bulkOps);
    console.log(`Finished. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
  } else {
    console.log('No updates required.');
  }

  await mongoose.disconnect();
  console.log('Disconnected. Done.');
}

run().catch(console.error);
