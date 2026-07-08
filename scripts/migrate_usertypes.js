const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined in .env file');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected successfully.');

  const User = require('../models/User');

  // 1. Update "Retailer and Distributor" to "retailer"
  const res1 = await User.updateMany(
    { userType: 'Retailer and Distributor' },
    { $set: { userType: 'retailer' } }
  );
  console.log(`Updated ${res1.modifiedCount} users from "Retailer and Distributor" to "retailer".`);

  // 2. Normalize case for standard types
  const resRetailer = await User.updateMany(
    { userType: { $regex: /^retailer$/i, $ne: 'retailer' } },
    { $set: { userType: 'retailer' } }
  );
  console.log(`Normalized case for ${resRetailer.modifiedCount} "retailer" users.`);

  const resDistributor = await User.updateMany(
    { userType: { $regex: /^distributor$/i, $ne: 'distributor' } },
    { $set: { userType: 'distributor' } }
  );
  console.log(`Normalized case for ${resDistributor.modifiedCount} "distributor" users.`);

  const resWholesaler = await User.updateMany(
    { userType: { $regex: /^wholesaler$/i, $ne: 'wholesaler' } },
    { $set: { userType: 'wholesaler' } }
  );
  console.log(`Normalized case for ${resWholesaler.modifiedCount} "wholesaler" users.`);

  // 3. For any other invalid/empty userType, check if we want to fallback or leave
  const invalidUsers = await User.find({
    role: 'user',
    userType: { $nin: ['retailer', 'distributor', 'wholesaler'] }
  });

  if (invalidUsers.length > 0) {
    console.log(`Found ${invalidUsers.length} users with missing or unrecognized user types. Setting them to "retailer" fallback...`);
    const resFallback = await User.updateMany(
      {
        role: 'user',
        userType: { $nin: ['retailer', 'distributor', 'wholesaler'] }
      },
      { $set: { userType: 'retailer' } }
    );
    console.log(`Updated ${resFallback.modifiedCount} users to "retailer" fallback.`);
  } else {
    console.log('All users now have valid userTypes: retailer, distributor, or wholesaler.');
  }

  process.exit(0);
}

main().catch(console.error);
