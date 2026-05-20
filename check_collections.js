const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });
const Collection = require('./models/Collection');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const cols = await Collection.find({});
  console.log('Total Collections:', cols.length);
  cols.forEach(c => console.log(c.name, c.subCollections ? c.subCollections.length : 0));
  
  // also check products
  const Product = require('./models/Product');
  const prods = await Product.find({}).limit(1);
  if (prods.length > 0) {
     console.log('Sample product assignedCollections:', prods[0].assignedCollections);
  }
  process.exit(0);
}
run();
