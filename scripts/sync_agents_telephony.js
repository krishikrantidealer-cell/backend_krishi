const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const User = require('../models/User');

const AGENT_CONFIGS = [
  {
    name: 'Anshika Gupta',
    phoneNumber: '9399022067',
    accountName: 'Ram Ji Shukla -2',
    did: '07316917267',
    publicIvrId: '6ac391dc6b832209',
    userUuid: '6abe3b1d94d37977',
    vid: '11',
  },
  {
    name: 'Runa Singh',
    phoneNumber: '9201896604',
    accountName: 'Ram Ji Shukla -3',
    did: '07316917220',
    publicIvrId: '6ac3926ed5589198',
    userUuid: '6abe3cdaa65d9730',
    vid: '11',
  },
  {
    name: 'Ajay Yadav',
    phoneNumber: '9201896606',
    accountName: 'Ram Ji Shukla -4',
    did: '07316917210',
    publicIvrId: '6ac392e50b66c496',
    userUuid: '6abe3e4363d3e779',
    vid: '11',
  },
  {
    name: 'Ram Ji Shukla',
    phoneNumber: '9399022063',
    accountName: 'Ram Ji Shukla -5',
    did: '07316917208',
    publicIvrId: '6abf9971d5b34126',
    userUuid: '6abe40026e466397',
    vid: '11',
  },
  {
    name: 'Ram Shukla (Alternate)',
    phoneNumber: '9399022058',
    accountName: 'Ram Ji Shukla -5',
    did: '07316917208',
    publicIvrId: '6abf9971d5b34126',
    userUuid: '6abe40026e466397',
    vid: '11',
  },
  {
    name: 'Garima',
    phoneNumber: '9201896603',
    accountName: 'Ram Ji Shukla -6',
    did: '07316917216',
    publicIvrId: '6ac3932d1bae5749',
    userUuid: '6abe41494bcb1499',
    vid: '11',
  },
];

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('No MONGODB_URI found in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  for (const cfg of AGENT_CONFIGS) {
    const cleanPhone = cfg.phoneNumber.replace(/\D/g, '');
    const users = await User.find({
      $or: [
        { phoneNumber: cleanPhone },
        { phoneNumber: `+91${cleanPhone}` },
        { phoneNumber: `91${cleanPhone}` },
        { phoneNumber: `0${cleanPhone}` }
      ]
    });

    for (const user of users) {
      console.log(`Updating User: ${user.firstName} ${user.lastName || ''} (${user.phoneNumber})...`);
      user.myoperatorConfig = {
        did: cfg.did,
        vid: cfg.vid,
        extension: cfg.vid,
        userId: cfg.userUuid,
        uuid: cfg.userUuid,
        publicIvrId: cfg.publicIvrId,
        companyId: process.env.MYOPERATOR_COMPANY_ID || '6ab0de5d51766538',
        apiKey: process.env.MYOPERATOR_CALLING_X_API_KEY,
        secretKey: process.env.MYOPERATOR_CALLING_SECRET_KEY,
        token: process.env.MYOPERATOR_CALLING_TOKEN,
        receiveCalls: true,
      };
      user.isAvailableForCalls = true;
      await user.save();
      console.log(`✅ Successfully updated ${user.firstName} ${user.lastName || ''} with DID: ${cfg.did}, IVR: ${cfg.publicIvrId}, UUID: ${cfg.userUuid}`);
    }
  }

  // Print all sales agents and their myoperatorConfig
  const allSales = await User.find({ role: { $in: ['sales', 'admin'] } });
  console.log('\n--- CURRENT TELEPHONY AGENTS IN DB ---');
  for (const u of allSales) {
    console.log(`- ${u.firstName} ${u.lastName || ''} | Phone: ${u.phoneNumber} | DID: ${u.myoperatorConfig?.did || 'None'} | IVR: ${u.myoperatorConfig?.publicIvrId || 'None'} | UUID: ${u.myoperatorConfig?.userId || 'None'}`);
  }

  await mongoose.disconnect();
  console.log('\nDatabase sync finished.');
}

run().catch(console.error);
