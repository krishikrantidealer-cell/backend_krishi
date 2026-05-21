const mongoose = require('mongoose');
const Category = require('./models/Category');

mongoose.connect('mongodb+srv://developerkrishikranti:1a2S3d4F5g6H@cluster0.z5iil.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function test() {
  try {
    const cat = await Category.findOne({});
    console.log(cat);
  } catch (e) {
    console.error(e);
  }
  process.exit(0);
}
test();
