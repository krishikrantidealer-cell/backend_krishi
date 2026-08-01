/**
 * populate_banner_titles.js
 *
 * Migration: sets `bannerTitle = name` for every Collection and Category
 * that doesn't already have a bannerTitle. No static maps, no guessing.
 *
 * Admins can later edit individual bannerTitles from the admin panel.
 *
 * Run: node populate_banner_titles.js
 */

const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected!\n');

  const Collection = require('./models/Collection');
  const Category   = require('./models/Category');

  // ── Collections ────────────────────────────────────────────────────────────
  console.log('=== COLLECTIONS ===');
  const collections = await Collection.find({}).lean();
  let colUpdated = 0;

  for (const col of collections) {
    if (col.bannerTitle && col.bannerTitle.trim()) {
      console.log(`[SKIP] "${col.name}" → already: "${col.bannerTitle}"`);
      continue;
    }
    await Collection.findByIdAndUpdate(col._id, { $set: { bannerTitle: col.name } });
    console.log(`[SET]  "${col.name}" → bannerTitle: "${col.name}"`);
    colUpdated++;
  }

  console.log(`\nCollections updated: ${colUpdated}\n`);

  // ── Categories ─────────────────────────────────────────────────────────────
  console.log('=== CATEGORIES ===');
  const categories = await Category.find({}).lean();
  let catUpdated = 0;

  for (const cat of categories) {
    if (cat.bannerTitle && cat.bannerTitle.trim()) {
      console.log(`[SKIP] "${cat.name}" → already: "${cat.bannerTitle}"`);
      continue;
    }
    await Category.findByIdAndUpdate(cat._id, { $set: { bannerTitle: cat.name } });
    console.log(`[SET]  "${cat.name}" → bannerTitle: "${cat.name}"`);
    catUpdated++;
  }

  console.log(`\nCategories updated: ${catUpdated}`);
  console.log(`\nDone! Total: ${colUpdated + catUpdated} records updated.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
