require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const Category = require('./models/Category');
const Product = require('./models/Product');
const connectDB = require('./config/db');

async function migrateSuvirat() {
  await connectDB();

  // ── 1. Find the Fertilizers category ─────────────────────────────────────
  const fertCategory = await Category.findOne({ name: /fertilizers/i });
  if (!fertCategory) {
    console.error('❌  "Fertilizers" category not found in DB. Aborting.');
    process.exit(1);
  }
  console.log(`✅  Found category: "${fertCategory.name}" (${fertCategory._id})`);

  // ── 2. Ensure "Organic" sub-category exists ───────────────────────────────
  const existingSub = fertCategory.subCategories.find(
    (s) => s.name.toLowerCase() === 'organic'
  );

  let organicSubId;
  if (existingSub) {
    organicSubId = existingSub._id;
    console.log(`ℹ️   Sub-category "Organic" already exists (${organicSubId})`);
  } else {
    fertCategory.subCategories.push({ name: 'Organic' });
    await fertCategory.save();
    const saved = fertCategory.subCategories.find(
      (s) => s.name.toLowerCase() === 'organic'
    );
    organicSubId = saved._id;
    console.log(`✅  Created sub-category "Organic" (${organicSubId})`);
  }

  // ── 3. Find the Suvirat product ───────────────────────────────────────────
  const suvirat = await Product.findOne({ title: /suvirat/i });
  if (!suvirat) {
    console.error('❌  Product "Suvirat" not found. Aborting.');
    process.exit(1);
  }
  console.log(`✅  Found product: "${suvirat.title}" (${suvirat._id})`);
  console.log(`   Current categoryId   : ${suvirat.categoryId}`);
  console.log(`   Current subCategoryId: ${suvirat.subCategoryId}`);

  // ── 4. Update the product ─────────────────────────────────────────────────
  suvirat.categoryId = fertCategory._id;
  suvirat.subCategoryId = organicSubId;
  await suvirat.save();

  console.log('\n🎉  Migration complete!');
  console.log(`   "${suvirat.title}" → Category: Fertilizers | Sub-category: Organic`);

  process.exit(0);
}

migrateSuvirat().catch((err) => {
  console.error('❌  Migration failed:', err);
  process.exit(1);
});
