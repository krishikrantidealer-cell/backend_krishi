const mongoose = require('mongoose');
const CallLog = require('../models/CallLog');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://krishikrantidealer_db_user:KrishiKranti%402026@krishikranti.tyerpvc.mongodb.net/krishikranti_db?appName=KrishiKranti';

async function clearCallLogs() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');
    const countBefore = await CallLog.countDocuments();
    console.log(`Current CallLog count: ${countBefore}`);
    
    const result = await CallLog.deleteMany({});
    console.log(`Deleted ${result.deletedCount} call logs.`);
    
    const countAfter = await CallLog.countDocuments();
    console.log(`Remaining CallLog count: ${countAfter}`);
    
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  } catch (err) {
    console.error('Error clearing call logs:', err);
    process.exit(1);
  }
}

clearCallLogs();
