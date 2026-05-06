require('dotenv').config({ path: __dirname + '/.env' });
const connectDB = require('./config/db');
const productController = require('./controllers/product.controller');

async function testBestOffers() {
  await connectDB();
  
  const req = {};
  const res = {
    json: (data) => {
      console.log("Success:", data.success);
      console.log("Best Offers Banners Count:", data.bestOffersBanners ? data.bestOffersBanners.length : 0);
      if (data.bestOffersBanners && data.bestOffersBanners.length > 0) {
        console.log("Best Offers Banners:", JSON.stringify(data.bestOffersBanners, null, 2));
      } else {
        console.log("No best offers banners found!");
      }
      process.exit(0);
    },
    status: (code) => res
  };
  const next = (err) => {
    console.error("Error:", err);
    process.exit(1);
  };
  
  await productController.getHomeDiscovery(req, res, next);
}

testBestOffers();
