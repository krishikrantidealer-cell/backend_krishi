require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Banner = require('./models/Banner');

async function checkBanners() {
  await connectDB();
  const allBanners = await Banner.find({});
  console.log(`Total banners in DB: ${allBanners.length}`);
  const types = {};
  allBanners.forEach(b => {
    types[b.type] = (types[b.type] || 0) + 1;
    console.log(`- _id: ${b._id}, type: "${b.type}", isActive: ${b.isActive}, priority: ${b.priority}, imageUrl: "${b.imageUrl}"`);
  });
  console.log("\nCounts by Type:", types);
  process.exit(0);
}

checkBanners();
