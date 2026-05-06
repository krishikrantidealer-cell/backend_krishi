require('dotenv').config({ path: __dirname + '/.env' });
const connectDB = require('./config/db');
const productController = require('./controllers/product.controller');

async function testController() {
  await connectDB();
  
  const req = {};
  const res = {
    json: (data) => {
      console.log("Success:", data.success);
      console.log("Banners Count:", data.banners ? data.banners.length : 0);
      console.log("Category Banners Count:", data.categoryBanners ? data.categoryBanners.length : 0);
      console.log("Category Card Banners Count:", data.categoryCardBanners ? data.categoryCardBanners.length : 0);
      if (data.categoryBanners && data.categoryBanners.length > 0) {
        console.log("Sample Category Banner:", data.categoryBanners[0]);
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

testController();
