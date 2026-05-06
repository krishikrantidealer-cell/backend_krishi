require('dotenv').config({ path: __dirname + '/.env' });
const Banner = require('./models/Banner');
const connectDB = require('./config/db');

async function checkBanners() {
  await connectDB();
  const banners = await Banner.find({});
  console.log(`Found ${banners.length} banners in DB.`);
  banners.forEach(b => console.log(b));
  process.exit(0);
}
checkBanners();
