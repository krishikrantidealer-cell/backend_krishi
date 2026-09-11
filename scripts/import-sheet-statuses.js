require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { google } = require('googleapis');
const { getServiceAccountCredentials } = require('../config/serviceAccountCredentials');
const connectDB = require('../config/db');
const Order = require('../models/Order');

async function importStatusesFromSheet() {
  try {
    await connectDB();
    console.log('✅ Database connected.');

    const credentials = getServiceAccountCredentials();
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      credentials,
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetIdToUse = (process.env.GOOGLE_SHEETS_ID || '19F0kkAqlhgRGyCIzTFu3Inppc6wighXStMZA5yCMu5E').trim();
    const customTab = process.env.GOOGLE_SHEETS_TAB_NAME || 'Form Responses 1';

    console.log(`📊 Fetching sheet rows from tab "${customTab}" in spreadsheet ${sheetIdToUse}...`);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetIdToUse,
      range: `'${customTab}'!A:AD`,
    });

    const allRows = res.data.values || [];
    if (allRows.length <= 1) {
      console.log('⚠️ No data rows found in sheet');
      process.exit(0);
    }

    const headers = allRows[0];
    const orderIdCol = headers.findIndex(h => /order\s*id/i.test(h));
    const statusCol = headers.findIndex(h => /^order\s*status/i.test(h));
    const triggerCol = headers.findIndex(h => /trigger/i.test(h));
    const trackingCol = headers.findIndex(h => /tracking\s*id|awb/i.test(h));
    const courierCol = headers.findIndex(h => /courier\s*name/i.test(h));

    console.log({
      orderIdCol: `${orderIdCol} (${headers[orderIdCol]})`,
      statusCol: `${statusCol} (${headers[statusCol]})`,
      triggerCol: `${triggerCol} (${headers[triggerCol]})`,
      trackingCol: `${trackingCol} (${headers[trackingCol]})`,
      courierCol: `${courierCol} (${headers[courierCol]})`,
    });

    const statusMap = {
      'delivered': 'Delivered',
      'delivery': 'Delivered',
      'rto delivered': 'RTO Delivered',
      'in-transit': 'In-Transit',
      'in transit': 'In-Transit',
      'intransit': 'In-Transit',
      'rto initiated': 'RTO',
      'rto in-transit': 'RTO In-Transit',
      'rto-in-transit': 'RTO In-Transit',
      'out for delivery': 'Out for Delivery',
      'out-for-delivery': 'Out for Delivery',
      'shipped': 'Shipped',
      'dispatched': 'Shipped',
      'processing': 'Processing',
      'confirmed': 'Processing',
      'pending': 'Processing',
      'booked': 'Processing',
      'cancelled': 'Cancelled',
      'canceled': 'Cancelled',
      'rto': 'RTO',
    };

    const bulkOps = [];
    const statusStats = {};

    for (let r = 1; r < allRows.length; r++) {
      const row = allRows[r];
      const rawOrderId = orderIdCol >= 0 && row[orderIdCol] ? row[orderIdCol].toString().trim() : '';
      if (!rawOrderId) continue;

      // Primary status is from Column W ("Order Status"), fallback to Trigger if valid
      let rawStatus = statusCol >= 0 && row[statusCol] ? row[statusCol].toString().trim().toLowerCase() : '';
      if (!statusMap[rawStatus] && triggerCol >= 0 && row[triggerCol]) {
        const trig = row[triggerCol].toString().trim().toLowerCase();
        if (statusMap[trig]) {
          rawStatus = trig;
        }
      }

      const normalizedStatus = statusMap[rawStatus] || null;
      const trackingId = trackingCol >= 0 && row[trackingCol] ? row[trackingCol].toString().trim() : '';
      const courierName = courierCol >= 0 && row[courierCol] ? row[courierCol].toString().trim() : '';

      const updateFields = {};

      if (normalizedStatus) {
        updateFields.orderStatus = normalizedStatus;
        statusStats[normalizedStatus] = (statusStats[normalizedStatus] || 0) + 1;

        if (normalizedStatus === 'Processing') updateFields.processingAt = new Date();
        else if (normalizedStatus === 'Shipped') updateFields.shippedAt = new Date();
        else if (normalizedStatus === 'In-Transit' || normalizedStatus === 'In Transit') updateFields.inTransitAt = new Date();
        else if (normalizedStatus === 'Out for Delivery') updateFields.outForDeliveryAt = new Date();
        else if (normalizedStatus === 'Delivered') updateFields.deliveredAt = new Date();
        else if (normalizedStatus === 'Cancelled') updateFields.cancelledAt = new Date();
        else if (normalizedStatus === 'RTO' || normalizedStatus === 'RTO In-Transit' || normalizedStatus === 'RTO Delivered') updateFields.rtoAt = new Date();
      }

      if (trackingId) {
        updateFields.awbNumber = trackingId;
        updateFields.trackingUrl = `https://www.delhivery.com/track/package/${trackingId}`;
      }

      if (courierName) {
        updateFields.courierName = courierName;
      }

      if (Object.keys(updateFields).length > 0) {
        bulkOps.push({
          updateOne: {
            filter: { orderId: rawOrderId },
            update: { $set: updateFields },
          },
        });
      }
    }

    console.log(`📦 Prepared ${bulkOps.length} updates across all rows.`);
    console.log('Status breakdown mapped:', statusStats);

    if (bulkOps.length > 0) {
      const CHUNK_SIZE = 500;
      let totalMatched = 0;
      let totalModified = 0;

      for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
        const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
        const bulkRes = await Order.bulkWrite(chunk, { ordered: false });
        totalMatched += bulkRes.matchedCount || 0;
        totalModified += bulkRes.modifiedCount || 0;
        console.log(`Processed chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(bulkOps.length / CHUNK_SIZE)}: matched ${bulkRes.matchedCount}, modified ${bulkRes.modifiedCount}`);
      }

      console.log(`\n🎉 Sync from Sheet completed successfully!`);
      console.log(`Total orders found in DB: ${totalMatched}`);
      console.log(`Total orders updated with real status/AWB: ${totalModified}`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Import failed with error:', err);
    process.exit(1);
  }
}

importStatusesFromSheet();
