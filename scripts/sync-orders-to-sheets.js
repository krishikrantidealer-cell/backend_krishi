require('dotenv').config();
const connectDB = require('../config/db');
const sheetsService = require('../services/sheets.service');

const sync = async () => {
  try {
    await connectDB();
    console.log('Database connected. Starting Google Sheets sync...');
    const result = await sheetsService.syncAllOrdersToSheet();
    console.log(`Sync completed successfully. Synced ${result.count} orders.`);
    process.exit(0);
  } catch (error) {
    console.error('Sync failed with error:', error);
    process.exit(1);
  }
};

sync();
