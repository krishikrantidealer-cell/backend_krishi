require('dotenv').config({ path: __dirname + '/.env' });
const Product = require('./models/Product');
const connectDB = require('./config/db');

async function search() {
  await connectDB();
  const products = await Product.find({ title: { $regex: /Grow|Suvirat/i } });
  console.log(`Found ${products.length} products`);
  products.forEach(p => console.log(p.title, p.thumbnail));
  process.exit(0);
}
search();
