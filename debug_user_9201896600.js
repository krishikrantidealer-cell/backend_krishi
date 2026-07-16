const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not found in .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const User = require('./models/User');

  const phoneNumber = '9201896600';
  console.log(`Searching for user with phone: ${phoneNumber}`);

  const user = await User.findOne({ phoneNumber });

  if (!user) {
    console.log('User not found in database.');
    process.exit(0);
  }

  console.log('\n--- User Record (Raw) ---');
  console.log(JSON.stringify(user, null, 2));

  process.exit(0);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
