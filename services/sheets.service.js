const { google } = require('googleapis');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME = 'Orders'; // The tab name inside your Google Sheet

// Column headers — must match the append/update order below
const HEADERS = [
  'Order ID',
  'Placed At',
  'Customer Name',
  'Phone',
  'Shop Name',
  'Items Summary',
  'Total Amount (₹)',
  'Discount (₹)',
  'Payment Method',
  'Payment Status',
  'Order Status',
  'AWB Number',
  'Courier',
  'City / Tehsil',
  'State',
  'Pincode',
  'Last Synced At',
];

// ─── AUTH ─────────────────────────────────────────────────────────────────────
// Uses Application Default Credentials (ADC) — automatically works on Cloud Run
// via the attached Compute Service Account. No JSON key file needed.
let _sheetsClient = null;

function _getClient() {
  if (_sheetsClient) return _sheetsClient;

  const auth = new google.auth.GoogleAuth({
    // On Cloud Run, ADC picks up the service account automatically.
    // Locally, run: gcloud auth application-default login
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Checks whether the header row exists. If not, inserts it as row 1.
 */
async function _ensureHeaders(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:A1`,
  });

  const firstCell = res.data.values && res.data.values[0] && res.data.values[0][0];
  if (firstCell === 'Order ID') return; // Headers already present

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  });

  console.log('[Sheets] Header row created.');
}

/**
 * Builds a flat row array from an order document.
 * Works whether the order's `user` field is populated (object) or just an ID.
 */
function _buildRow(order) {
  const user = order.user;
  const isPopulated = user && typeof user === 'object';

  const firstName  = isPopulated ? (user.firstName  || '') : '';
  const lastName   = isPopulated ? (user.lastName   || '') : '';
  const customerName = `${firstName} ${lastName}`.trim() || 'Unknown';
  const phone      = isPopulated ? (user.phoneNumber || '') : '';
  const shopName   = isPopulated ? (user.shopName   || '') : '';

  // Summarise items: "Product A x2, Product B x1"
  const itemsSummary = (order.items || [])
    .map(i => `${i.title} x${i.quantity}`)
    .join(', ');

  const addr = order.shippingAddress || {};

  return [
    order.orderId             || '',
    order.placedAt ? new Date(order.placedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    customerName,
    phone,
    shopName,
    itemsSummary,
    order.totalAmount         || 0,
    order.discountAmount      || 0,
    order.paymentMethod       || '',
    order.paymentStatus       || '',
    order.orderStatus         || '',
    order.awbNumber           || '',
    order.courierName         || '',
    addr.cityTehsil           || '',
    addr.state                || '',
    addr.pincode              || '',
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  ];
}

/**
 * Finds the row number (1-indexed) for a given Order ID.
 * Returns null if not found.
 */
async function _findRowByOrderId(sheets, orderId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:A`, // Scan only column A (Order ID)
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === orderId) return i + 1; // 1-indexed
  }
  return null;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Called when a new order is placed.
 * Appends a new row to the sheet.
 */
exports.appendOrder = async (order) => {
  if (!SHEET_ID) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping append.');
    return;
  }

  try {
    const sheets = _getClient();
    await _ensureHeaders(sheets);
    const row = _buildRow(order);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    console.log(`[Sheets] ✅ Order ${order.orderId} appended to sheet.`);
  } catch (err) {
    // Never throw — sheets failure must never block order placement
    console.error(`[Sheets] ❌ Failed to append order ${order.orderId}:`, err.message);
  }
};

/**
 * Called when an order status is updated.
 * Finds the existing row by Order ID and overwrites it with fresh data.
 * Falls back to appending if the row is not found (e.g., sheet was cleared).
 */
exports.updateOrderRow = async (order) => {
  if (!SHEET_ID) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping update.');
    return;
  }

  try {
    const sheets = _getClient();
    await _ensureHeaders(sheets);
    const row = _buildRow(order);

    const rowNumber = await _findRowByOrderId(sheets, order.orderId);

    if (rowNumber) {
      // Update the existing row in-place
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      console.log(`[Sheets] ✅ Order ${order.orderId} updated at row ${rowNumber}.`);
    } else {
      // Row missing (sheet may have been cleared) — append instead
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
      console.log(`[Sheets] ✅ Order ${order.orderId} not found — appended as new row.`);
    }
  } catch (err) {
    console.error(`[Sheets] ❌ Failed to update order ${order.orderId}:`, err.message);
  }
};
