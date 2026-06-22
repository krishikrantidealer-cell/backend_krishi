const { google } = require('googleapis');
const User = require('../models/User');
const Product = require('../models/Product');

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
  'Quantity',
  'Price (₹)',
  'Total Amount (₹)',
  'Discount (₹)',
  'Razorpay Payment ID',
  'Advance Paid (₹)',
  'Remaining (₹)',
  'Payment Method',
  'Payment Status',
  'Order Status',
  'AWB Number',
  'Courier',
  'Address',
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
 * Ensures the 'Orders' sheet exists, has correct headers,
 * and sets up data validation dropdown for Order Status (Column P).
 */
async function _ensureSheetAndValidation(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });

  let sheet = spreadsheet.data.sheets.find(s => s.properties.title === SHEET_NAME);
  let sheetId;

  if (!sheet) {
    console.log(`[Sheets] Sheet "${SHEET_NAME}" does not exist. Creating...`);
    const addSheetRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: SHEET_NAME,
              },
            },
          },
        ],
      },
    });
    sheetId = addSheetRes.data.replies[0].addSheet.properties.sheetId;
  } else {
    sheetId = sheet.properties.sheetId;
  }

  // Ensure headers
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!1:1`,
  });

  const existingHeaders = (res.data.values && res.data.values[0]) || [];
  const headersMatch =
    existingHeaders.length === HEADERS.length &&
    HEADERS.every((h, i) => existingHeaders[i] === h);

  if (!headersMatch) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    console.log('[Sheets] Header row updated.');
  }

  // Apply dropdown validation for Column P (index 15)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: sheetId,
              startRowIndex: 1, // Skip header row
              startColumnIndex: 15, // Column P
              endColumnIndex: 16,
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: [
                  { userEnteredValue: 'Processing' },
                  { userEnteredValue: 'Shipped' },
                  { userEnteredValue: 'Out for Delivery' },
                  { userEnteredValue: 'Delivered' },
                  { userEnteredValue: 'Cancelled' },
                  { userEnteredValue: 'RTO' },
                ],
              },
              showCustomUi: true,
              strict: true,
            },
          },
        },
      ],
    },
  });

  return sheetId;
}

/**
 * Fetches the user document from DB.
 * order.user is always just an ObjectId after Order.create() / findById(),
 * so we must query separately to get firstName, phoneNumber, shopName.
 */
async function _fetchUser(order) {
  const userId = order.user && order.user._id ? order.user._id : order.user;
  if (!userId) return null;
  try {
    return await User.findById(userId).select('firstName lastName phoneNumber shopName').lean();
  } catch {
    return null;
  }
}

/**
 * Enriches order items with variantSize and basePacking by looking up
 * the Product's variants array and matching on variantId.
 * Order items in MongoDB only store ObjectId refs — not the size text.
 */
async function _enrichItemsWithVariantSize(items) {
  if (!items || items.length === 0) return items;

  const productIds = [...new Set(
    items.map(i => (i.product?._id || i.product)?.toString()).filter(Boolean)
  )];

  const products = await Product.find({ _id: { $in: productIds } })
    .select('variants')
    .lean();

  const productMap = {};
  for (const p of products) productMap[p._id.toString()] = p;

  return items.map(item => {
    const productId = (item.product?._id || item.product)?.toString();
    const product   = productMap[productId];
    if (!product) return item;

    const variant = (product.variants || []).find(
      v => v._id?.toString() === item.variantId?.toString()
    );

    return {
      ...(item.toObject ? item.toObject() : { ...item }),
      variantSize:  variant?.size        || '',
      basePacking:  variant?.basePacking || '',
    };
  });
}


function _buildRow(order, user) {
  const firstName = user ? (user.firstName || '') : '';
  const lastName = user ? (user.lastName || '') : '';
  const customerName = `${firstName} ${lastName}`.trim() || 'Unknown';
  const phone = user ? (user.phoneNumber || '') : '';
  const shopName = user ? (user.shopName || '') : '';

  // Items Summary — one product per line with pack size
  // Quantity     — matching quantities, one per line
  // Price        — matching unit prices, one per line
  const items = order.items || [];
  const freeItems = order.freeItems || [];

  const itemsSummaryList = items.map(i => {
    const packSize = i.variantSize || i.basePacking || '';
    return packSize ? `${i.title} (${packSize})` : i.title;
  });

  const quantitySummaryList = items.map(i => `${i.quantity}`);
  const priceSummaryList = items.map(i => `₹${(i.price * i.quantity).toFixed(2)}`);

  // Append free items if any
  for (const fItem of freeItems) {
    itemsSummaryList.push(`${fItem.name} (Free Gift)`);
    quantitySummaryList.push(`${fItem.quantity}`);
    priceSummaryList.push(`₹0.00 (Free)`);
  }

  const itemsSummary = itemsSummaryList.join('\n');
  const quantitySummary = quantitySummaryList.join('\n');
  const priceSummary = priceSummaryList.join('\n');

  const addr = order.shippingAddress || {};

  // Build complete address string
  const fullAddress = [
    addr.villageArea,
    addr.cityTehsil,
    addr.state,
    addr.pincode,
  ].filter(Boolean).join(', ');

  return [
    order.orderId || '',
    order.placedAt ? new Date(order.placedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    customerName,
    phone,
    shopName,
    itemsSummary,
    quantitySummary,
    priceSummary,
    order.totalAmount || 0,
    order.discountAmount || 0,
    order.razorpayPaymentId || '',
    order.advanceAmount || 0,
    order.remainingAmount || 0,
    order.paymentMethod || '',
    order.paymentStatus || '',
    order.orderStatus || '',
    order.awbNumber || '',
    order.courierName || '',
    fullAddress,
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
    await _ensureSheetAndValidation(sheets);

    // Fetch user separately — order.user is just an ObjectId after Order.create()
    const user = await _fetchUser(order);
    // Enrich items with variantSize/basePacking from Product variants
    const enrichedItems = await _enrichItemsWithVariantSize(order.items || []);
    const row = _buildRow({ ...order.toObject ? order.toObject() : order, items: enrichedItems }, user);

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
    await _ensureSheetAndValidation(sheets);

    // Fetch user separately — order.user is just an ObjectId after findById()
    const user = await _fetchUser(order);
    // Enrich items with variantSize/basePacking from Product variants
    const enrichedItems = await _enrichItemsWithVariantSize(order.items || []);
    const row = _buildRow({ ...order.toObject ? order.toObject() : order, items: enrichedItems }, user);

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

/**
 * Syncs all orders in the database to the Google Sheet.
 * This overwrites the existing sheet data.
 */
exports.syncAllOrdersToSheet = async () => {
  if (!SHEET_ID) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping syncAllOrdersToSheet.');
    return { success: false, message: 'GOOGLE_SHEETS_ID not set' };
  }

  try {
    const Order = require('../models/Order');
    const sheets = _getClient();
    await _ensureSheetAndValidation(sheets);

    console.log('[Sheets] Fetching all orders from database...');
    const orders = await Order.find({})
      .populate('user', 'firstName lastName phoneNumber shopName')
      .sort({ placedAt: 1 })
      .exec();

    console.log(`[Sheets] Found ${orders.length} orders. Enriching items...`);

    const productIds = [];
    orders.forEach(o => {
      const items = o.items || [];
      items.forEach(i => {
        const productId = (i.product?._id || i.product)?.toString();
        if (productId) productIds.push(productId);
      });
    });
    const uniqueProductIds = [...new Set(productIds)];
    const products = await Product.find({ _id: { $in: uniqueProductIds } })
      .select('variants')
      .lean();

    const productMap = {};
    for (const p of products) {
      productMap[p._id.toString()] = p;
    }

    const rows = [];
    for (const order of orders) {
      const enrichedItems = (order.items || []).map(item => {
        const productId = (item.product?._id || item.product)?.toString();
        const product = productMap[productId];
        if (!product) return item;

        const variant = (product.variants || []).find(
          v => v._id?.toString() === item.variantId?.toString()
        );

        return {
          ...(item.toObject ? item.toObject() : { ...item }),
          variantSize: variant?.size || '',
          basePacking: variant?.basePacking || '',
        };
      });

      const user = order.user;

      const row = _buildRow(
        {
          ...(order.toObject ? order.toObject() : order),
          items: enrichedItems,
        },
        user
      );
      rows.push(row);
    }

    console.log('[Sheets] Overwriting sheet with all orders...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:Z`,
    });

    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });
    }

    console.log(`[Sheets] ✅ Sync completed. ${rows.length} orders synced.`);
    return { success: true, count: rows.length };
  } catch (err) {
    console.error('[Sheets] ❌ Failed to sync all orders:', err.message);
    throw err;
  }
};


