require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const { hashData } = require('../utils/hash');

async function seedAdmin() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected successfully!");

    // 1. Seed Admin
    const adminEmail = 'admin@krishikranti.com';
    const adminPassword = 'adminpassword';
    const adminPhone = '9999999999';
    
    let adminUser = await User.findOne({ $or: [{ email: adminEmail }, { phoneNumber: adminPhone }] });

    const hashedPassword = await hashData(adminPassword);
    if (!adminUser) {
      adminUser = await User.create({
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        firstName: 'System',
        lastName: 'Administrator',
        phoneNumber: adminPhone,
        isVerified: true,
        isProfileComplete: true,
        isKycComplete: true,
        kycStatus: 'verified'
      });
      console.log(`✅ Admin user created: email: "${adminEmail}", password: "${adminPassword}"`);
    } else {
      adminUser.email = adminEmail;
      adminUser.password = hashedPassword;
      adminUser.role = 'admin';
      adminUser.phoneNumber = adminPhone;
      adminUser.isVerified = true;
      await adminUser.save();
      console.log(`✅ Admin user updated: email: "${adminEmail}", password: "${adminPassword}"`);
    }

    // 2. Seed Sales
    const salesEmail = 'sales@krishikranti.com';
    const salesPassword = 'salespassword';
    const salesPhone = '8888888888';
    
    let salesUser = await User.findOne({ $or: [{ email: salesEmail }, { phoneNumber: salesPhone }] });
    const hashedSalesPassword = await hashData(salesPassword);

    if (!salesUser) {
      salesUser = await User.create({
        email: salesEmail,
        password: hashedSalesPassword,
        role: 'sales',
        firstName: 'Sales',
        lastName: 'Agent',
        phoneNumber: salesPhone,
        isVerified: true,
        isProfileComplete: true,
        isKycComplete: true,
        kycStatus: 'verified'
      });
      console.log(`✅ Sales user created: email: "${salesEmail}", password: "${salesPassword}"`);
    } else {
      salesUser.email = salesEmail;
      salesUser.password = hashedSalesPassword;
      salesUser.role = 'sales';
      salesUser.phoneNumber = salesPhone;
      salesUser.isVerified = true;
      await salesUser.save();
      console.log(`✅ Sales user updated: email: "${salesEmail}", password: "${salesPassword}"`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

seedAdmin();
