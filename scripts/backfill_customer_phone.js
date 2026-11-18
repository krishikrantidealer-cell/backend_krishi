const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('../config/db');

async function run() {
  console.log('Connecting to database via connectDB...');
  await connectDB();
  console.log('Connected to database.');

  const CallLog = mongoose.connection.collection('calllogs');
  const Contact = mongoose.connection.collection('contacts');

  const KNOWN_AGENT_PHONES = ['9201896606', '9399022063', '9399022061', '9201896604'];

  const logsToFix = await CallLog.find({
    $or: [
      { customerPhone: 'Unknown' },
      { customerPhone: { $exists: false } },
      { customerPhone: null },
      { customerPhone: '' },
      { customerPhone: { $in: KNOWN_AGENT_PHONES } }
    ]
  }).toArray();

  console.log(`Found ${logsToFix.length} call logs needing customer phone backfill.`);

  let updatedCount = 0;
  let skippedCount = 0;
  const bulkOps = [];

  for (const log of logsToFix) {
    let rawPhone = log.metadata?.customer_identifier ||
                   log.metadata?.payload?.customer_identifier ||
                   log.metadata?.payload?.legs?.find(l => l.type === 'customer')?.phone_number ||
                   log.metadata?.legs?.find(l => l.type === 'customer')?.phone_number;

    if (!rawPhone && Array.isArray(log.metadata?.payload?.legs)) {
      const nonAgent = log.metadata.payload.legs.find(l => {
        if (!l.phone_number) return false;
        const clean = String(l.phone_number).replace(/\D/g, '').replace(/^91/, '');
        return l.type !== 'agent' && !KNOWN_AGENT_PHONES.includes(clean);
      });
      if (nonAgent) rawPhone = nonAgent.phone_number;
    }

    if (!rawPhone && Array.isArray(log.metadata?.legs)) {
      const nonAgent = log.metadata.legs.find(l => {
        if (!l.phone_number) return false;
        const clean = String(l.phone_number).replace(/\D/g, '').replace(/^91/, '');
        return l.type !== 'agent' && !KNOWN_AGENT_PHONES.includes(clean);
      });
      if (nonAgent) rawPhone = nonAgent.phone_number;
    }

    if (!rawPhone && log.contactId) {
      const contact = await Contact.findOne({ _id: log.contactId });
      if (contact && contact.phone) rawPhone = contact.phone;
    }

    if (!rawPhone) {
      skippedCount++;
      continue;
    }

    const cleanPhone = String(rawPhone).replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
    if (!cleanPhone || cleanPhone.length < 5 || KNOWN_AGENT_PHONES.includes(cleanPhone)) {
      skippedCount++;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: log._id },
        update: { $set: { customerPhone: cleanPhone } }
      }
    });

    if (bulkOps.length >= 200) {
      await CallLog.bulkWrite(bulkOps);
      updatedCount += bulkOps.length;
      bulkOps.length = 0;
      console.log(`Updated ${updatedCount} calls so far...`);
    }
  }

  if (bulkOps.length > 0) {
    await CallLog.bulkWrite(bulkOps);
    updatedCount += bulkOps.length;
  }

  console.log(`Backfill completed! Total Updated: ${updatedCount}, Skipped: ${skippedCount}`);

  const remainingUnknown = await CallLog.countDocuments({ customerPhone: 'Unknown' });
  console.log(`Remaining Unknown customerPhone count: ${remainingUnknown}`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
