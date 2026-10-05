const mongoose = require('mongoose');
require('dotenv').config();

const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const CannedResponse = require('../models/CannedResponse');

async function clean() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('No MONGODB_URI found.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');

  // Remove dummy seed templates
  const dummyTemplateNames = [
    'krishi_order_dispatch',
    'krishi_welcome_greeting',
    'krishi_payment_reminder'
  ];

  const resTemplates = await WhatsAppTemplate.deleteMany({
    name: { $in: dummyTemplateNames }
  });
  console.log(`Deleted ${resTemplates.deletedCount} dummy templates.`);

  // Remove dummy canned replies
  const dummyShortcuts = ['/greeting', '/bank', '/dispatch', '/catalog', '/dealer'];
  const resCanned = await CannedResponse.deleteMany({
    shortcut: { $in: dummyShortcuts }
  });
  console.log(`Deleted ${resCanned.deletedCount} dummy canned responses.`);

  const remainingTemplates = await WhatsAppTemplate.find().lean();
  console.log(`Remaining real WhatsApp templates in DB: ${remainingTemplates.length}`);
  for (const t of remainingTemplates) {
    console.log(`- ${t.name} (${t.category}) [${t.status}]`);
  }

  await mongoose.disconnect();
  console.log('Cleanup finished.');
}

clean().catch(console.error);
