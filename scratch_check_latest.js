require('dotenv').config({ path: __dirname + '/.env' });
const Product = require('./models/Product');
const connectDB = require('./config/db');

async function check() {
  await connectDB();
  const products = await Product.find({}).sort({ _id: -1 }).limit(5);
  products.forEach(p => console.log(p._id, p.title, p.thumbnail));
  process.exit(0);
}
check();
