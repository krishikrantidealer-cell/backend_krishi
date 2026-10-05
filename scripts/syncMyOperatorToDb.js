require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const myoperatorAccounts = require('../config/myoperatorAccounts');

async function syncMyOperatorAccounts() {
  try {
    const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB successfully!\n');

    // 1. Sync Main Admin Account
    console.log('--- Syncing Admin Account ---');
    const adminUser = await User.findOne({
      $or: [
        { email: 'admin@krishikranti.com' },
        { phoneNumber: '9098544263' }
      ]
    });

    if (adminUser) {
      adminUser.myoperatorConfig = {
        companyId: myoperatorAccounts.main.companyId,
        token: myoperatorAccounts.main.callingToken,
        secretKey: myoperatorAccounts.main.callingSecretKey,
        wabaKey: myoperatorAccounts.main.wabaKey,
        wabaPhoneNumberId: myoperatorAccounts.main.wabaPhoneNumberId,
        whatsappNumber: myoperatorAccounts.main.whatsappNumber,
        extension: myoperatorAccounts.main.extension,
        accountName: myoperatorAccounts.main.name
      };
      adminUser.isAvailableForCalls = true;
      await adminUser.save();
      console.log(`✅ Synced Admin: ${adminUser.firstName} ${adminUser.lastName || ''} (${adminUser.email}) -> Main Account (${myoperatorAccounts.main.companyId})`);
    }

    // 2. Exact Sales Agent Mapping Table
    const agentMappings = [
      {
        account: myoperatorAccounts.agents[0], // Ram Ji Shukla - 2 (WA: 7316917267)
        email: 'ebsale08@gmail.com',
        phone: '9399022067',
        name: 'Anshika Gupta'
      },
      {
        account: myoperatorAccounts.agents[1], // Ram Ji Shukla - 3 (WA: 7316917220)
        email: 'essentialsale14@gmail.com',
        phone: '9201896604',
        name: 'Runa Singh'
      },
      {
        account: myoperatorAccounts.agents[2], // Ram Ji Shukla - 4 (WA: 7316917210)
        email: 'essentialsale8@gmail.com',
        phone: '9201896606',
        name: 'Ajay Yadav'
      },
      {
        account: myoperatorAccounts.agents[3], // Ram Ji Shukla - 5 (WA: 7316917208)
        email: 'sales3.essential@gmail.com',
        phone: '9399022063',
        name: 'Yogesh Nandwanshi'
      },
      {
        account: myoperatorAccounts.agents[4], // Ram Ji Shukla - 6 (WA: 7316917216)
        email: 'essentialbiosciences12@gmail.com',
        phone: '9201896603',
        name: 'Garima Gokulpure'
      },
      {
        account: myoperatorAccounts.agents[4], // Eram Istiyaque (sales6.essential@gmail.com)
        email: 'sales6.essential@gmail.com',
        phone: '9201896608',
        name: 'Eram Istiyaque'
      }
    ];

    console.log('\n--- Syncing Sales Agents to Database ---');
    for (const mapping of agentMappings) {
      const user = await User.findOne({
        $or: [
          { email: mapping.email },
          { phoneNumber: mapping.phone }
        ]
      });

      if (user) {
        user.myoperatorConfig = {
          companyId: mapping.account.companyId,
          token: mapping.account.callingToken,
          secretKey: mapping.account.callingSecretKey,
          wabaKey: mapping.account.wabaKey,
          wabaPhoneNumberId: mapping.account.wabaPhoneNumberId,
          whatsappNumber: mapping.account.whatsappNumber,
          extension: mapping.account.extension || '11',
          accountName: mapping.account.accountName
        };
        user.isAvailableForCalls = true;
        await user.save();
        console.log(`✅ Synced: ${user.firstName} ${user.lastName || ''} | Email: ${user.email} | Phone: ${user.phoneNumber} -> ${mapping.account.accountName} (DID: ${mapping.account.whatsappNumber})`);
      } else {
        console.log(`⚠️ User not found for ${mapping.name} (${mapping.email} / ${mapping.phone})`);
      }
    }

    console.log('\n🎉 All Sales Agents Successfully Synced with MyOperator Credentials in MongoDB!');
    process.exit(0);
  } catch (error) {
    console.error('Error during sync:', error);
    process.exit(1);
  }
}

syncMyOperatorAccounts();
