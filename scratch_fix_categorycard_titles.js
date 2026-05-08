require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Banner = require('./models/Banner');

// ─────────────────────────────────────────────────────────────────────────────
// Map each category_card banner (by its priority / 0-based order in DB) to the
// real category name. Adjust this list if your banner order differs.
// Run with DRY_RUN=true first to inspect current state without making changes.
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  'Insecticides',
  'Fungicides',
  'Fertilizers',
  'PGRs',
  'Bio-Products',
  'Herbicides',
];

const DRY_RUN = process.argv.includes('--dry-run');

async function fixCategoryCardTitles() {
  await connectDB();

  // Fetch all category_card banners sorted by priority (the insertion order)
  const cardBanners = await Banner.find({ type: 'category_card' }).sort({ priority: 1 });

  if (cardBanners.length === 0) {
    console.log('❌  No category_card banners found in DB.');
    process.exit(1);
  }

  console.log(`\nFound ${cardBanners.length} category_card banners:\n`);
  cardBanners.forEach((b, i) => {
    const newTitle = CATEGORY_ORDER[i] ?? `Unknown-${i}`;
    console.log(`  [${i}] current title : "${b.title}"`);
    console.log(`       new title    : "${newTitle}"`);
    console.log(`       imageUrl     : ${b.imageUrl}\n`);
  });

  if (DRY_RUN) {
    console.log('🔍  DRY RUN — no changes written. Remove --dry-run to apply.');
    process.exit(0);
  }

  // Apply updates
  let updated = 0;
  for (let i = 0; i < cardBanners.length; i++) {
    const banner = cardBanners[i];
    const newTitle = CATEGORY_ORDER[i];

    if (!newTitle) {
      console.warn(`⚠️   No category name mapped for index ${i}. Skipping.`);
      continue;
    }

    await Banner.findByIdAndUpdate(banner._id, {
      title: newTitle,
      redirectType: 'category',
      redirectTarget: newTitle,   // so tapping the banner navigates to that category
    });

    console.log(`✅  Updated banner [${i}] → title: "${newTitle}"`);
    updated++;
  }

  console.log(`\n🎉  Done! Updated ${updated} of ${cardBanners.length} banners.`);
  process.exit(0);
}

fixCategoryCardTitles().catch((err) => {
  console.error('❌  Script failed:', err);
  process.exit(1);
});
