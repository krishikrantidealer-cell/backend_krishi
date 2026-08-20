const { google } = require('googleapis');
const User = require('../models/User');
const Product = require('../models/Product');
const path = require('path');
const fs = require('fs');

const { getServiceAccountCredentials } = require('../config/serviceAccountCredentials');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
function _getSheetId() {
  const envId = (process.env.GOOGLE_SHEETS_ID || '').trim();
  // Protect against stale/invalid sheet ID that lacks permissions
  if (!envId || envId === '1Lvlb9TOn6bUjxENfHisCpkhOEhernUktU7H6fxFwUjU') {
    return '19F0kkAqlhgRGyCIzTFu3Inppc6wighXStMZA5yCMu5E';
  }
  return envId;
}

function _getCustomTabName() {
  return process.env.GOOGLE_SHEETS_TAB_NAME || 'Form Responses 1';
}

// Target 27 Column Headers schema
const DEFAULT_HEADERS = [
  'Timestamp',
  'Email Address',
  'EBS Sales Person',
  'New/Replacement Order',
  "Customer's Full Name",
  'Mobile Number 1',
  'Mobile Number 2',
  'Address 1 (House no & Local Area ) For Example -  HIG 3/554, Arvind Vihar,Housing Board Colony, Bagmugaliya,',
  'Address 2 (City & State)  For Example -   Bhopal, Madhya Pradesh',
  'Pin Code',
  'Email Address',
  'Product Name & Quantity ',
  'Total Amount ',
  'Booking Amount',
  'Payment Mode (Cash/COD)',
  'COD Amount ',
  'Preferred Courier Partner ',
  'Payment Details(If Prepaid) - For Example - Transaction ID',
  'Order ID',
  'Tracking ID',
  'Courier Name',
  'Tracking Link',
  'Language',
  'Trigger',
  'Cost Price',
  'Courier Charges',
  'RTO Charges',
];

// ─── AUTH ─────────────────────────────────────────────────────────────────────
let _sheetsClient = null;

function _getClient() {
  if (_sheetsClient) return _sheetsClient;

  const credentials = getServiceAccountCredentials();
  const authOptions = {
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    credentials,
  };

  console.log(`[Sheets] Initialized with Service Account: ${credentials?.client_email || 'default'}`);

  const auth = new google.auth.GoogleAuth(authOptions);
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Converts a 0-based column index to spreadsheet column letters (0->A, 18->S, 26->AA).
 */
function _colIndexToLetter(index) {
  let letter = '';
  let temp = index;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Retrieves the spreadsheet metadata and the active tab name + headers.
 * NEVER clears or overwrites existing data or headers.
 */
async function _ensureSheetAndGetInfo(sheets) {
  const sheetIdToUse = _getSheetId();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: sheetIdToUse,
  });

  const allSheets = spreadsheet.data.sheets || [];
  if (allSheets.length === 0) {
    throw new Error('No sheets found in spreadsheet');
  }

  // Find target sheet tab or default to first tab
  let targetSheet = null;
  const customTab = _getCustomTabName();
  if (customTab) {
    targetSheet = allSheets.find(s => s.properties.title === customTab);
  }
  if (!targetSheet) {
    targetSheet = allSheets[0];
  }

  const sheetTitle = targetSheet.properties.title;
  const sheetId = targetSheet.properties.sheetId;

  // Read existing headers from Row 1
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetIdToUse,
    range: `'${sheetTitle}'!1:1`,
  });

  let existingHeaders = (res.data.values && res.data.values[0]) || [];

  // If sheet is completely blank, write default headers once
  if (existingHeaders.length === 0) {
    console.log(`[Sheets] Sheet "${sheetTitle}" is blank. Initializing headers...`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetIdToUse,
      range: `'${sheetTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [DEFAULT_HEADERS] },
    });
    existingHeaders = DEFAULT_HEADERS;
  }

  return { sheetTitle, sheetId, headers: existingHeaders };
}

/**
 * Fetches the user document from DB to populate customer & assigned agent info.
 */
async function _fetchUser(order) {
  const userId = order.user && order.user._id ? order.user._id : order.user;
  if (!userId) return null;
  try {
    return await User.findById(userId)
      .select('firstName lastName phoneNumber alternatePhone email shopName assignedAgent preferredLanguage isPanelCreated source createdVia')
      .populate('assignedAgent', 'firstName lastName phoneNumber email')
      .lean();
  } catch {
    return null;
  }
}

/**
 * Enriches order items with variantSize and basePacking.
 */
async function _enrichItemsWithVariantSize(items) {
  if (!items || items.length === 0) return items || [];

  const productIds = [...new Set(
    items.map(i => (i.product?._id || i.product)?.toString()).filter(Boolean)
  )];

  if (productIds.length === 0) return items;

  try {
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
  } catch (err) {
    console.warn('[Sheets] Variant enrichment skipped:', err.message);
    return items;
  }
}

/**
 * Dynamically builds a row matching the exact header order of the target sheet.
 */
function _buildRowForHeaders(headers, order, user) {
  const firstName = user ? (user.firstName || '') : '';
  const lastName = user ? (user.lastName || '') : '';
  const customerName = `${firstName} ${lastName}`.trim() || user?.shopName || 'Customer';
  const phone1 = user?.phoneNumber || order.shippingAddress?.phoneNumber || '';
  const phone2 = order.shippingAddress?.alternatePhone || user?.alternatePhone || '';
  const email = user?.email || '';

  // Extract Sales Agent Name
  let agentName = '-';
  if (user && user.assignedAgent) {
    const agent = user.assignedAgent;
    if (typeof agent === 'object') {
      agentName = `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.phoneNumber || agent.email || 'Agent';
    }
  }

  // Address components
  const addr = order.shippingAddress || {};
  const addr1 = addr.villageArea || addr.addressLine1 || addr.street || '';
  const addr2 = [addr.cityTehsil || addr.city, addr.state].filter(Boolean).join(', ');
  const pincode = addr.pincode || '';

  // Items Summary
  const items = order.items || [];
  const freeItems = order.freeItems || [];

  const itemsSummaryList = items.map(i => {
    const packSize = i.variantSize || i.basePacking || '';
    return packSize ? `${i.title} (${packSize}) - Qty: ${i.quantity}` : `${i.title} - Qty: ${i.quantity}`;
  });

  for (const fItem of freeItems) {
    itemsSummaryList.push(`${fItem.name} (Free Gift) - Qty: ${fItem.quantity}`);
  }
  const productSummary = itemsSummaryList.join('\n');

  // Dates & Payment
  const timestamp = order.placedAt
    ? new Date(order.placedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const totalAmount = order.totalAmount || 0;
  const bookingAmount = order.advanceAmount || 0;
  const remainingAmount = order.remainingAmount ?? (order.paymentMethod === 'Online' ? 0 : totalAmount);
  const paymentMode = order.paymentMethod || 'COD';
  const razorpayId = order.razorpayPaymentId || '';

  // Courier & Tracking
  const courier = order.courierName || 'Delhivery';
  const trackingId = order.awbNumber || '';
  const trackingLink = order.trackingUrl || (trackingId ? `https://www.delhivery.com/track/package/${trackingId}` : '');

  // Check if dealer is panel-created / tagged as panel
  const isPanelDealer = Boolean(
    user?.isPanelCreated === true ||
    (typeof user?.source === 'string' && user.source.toLowerCase().includes('panel')) ||
    (typeof user?.createdVia === 'string' && user.createdVia.toLowerCase() === 'panel') ||
    order.user?.isPanelCreated === true ||
    (typeof order.user?.source === 'string' && order.user.source.toLowerCase().includes('panel')) ||
    (typeof order.user?.createdVia === 'string' && order.user.createdVia.toLowerCase() === 'panel')
  );

  let orderType = order.orderType || (isPanelDealer ? 'Old' : 'New');
  if (isPanelDealer && (!order.orderType || order.orderType.toLowerCase() === 'new')) {
    orderType = 'Old';
  }

  const language = user?.preferredLanguage || 'Hindi';
  const trigger = order.orderStatus || 'Processing';
  const courierCharges = order.shippingCharges || 0;

  // Build row strictly matching each header in the target sheet
  return headers.map((rawHeader, idx) => {
    const h = (rawHeader || '').toString().trim().toLowerCase();

    if (h.includes('timestamp') || h.includes('placed at') || h === 'date') return timestamp;
    if (h.includes('ebs sales') || h.includes('sales agent') || h.includes('sales person')) return agentName;
    if (h.includes('new/replacement') || h.includes('order type')) return orderType;
    if (h.includes("customer's full name") || h.includes('customer name') || h === 'name') return customerName;
    if (h.includes('mobile number 1') || h === 'mobile 1' || h === 'phone' || h === 'mobile') return phone1;
    if (h.includes('mobile number 2') || h === 'mobile 2' || h.includes('alternate')) return phone2;
    if (h.includes('address 1') || h.includes('house no')) return addr1;
    if (h.includes('address 2') || h.includes('city & state') || h === 'city') return addr2;
    if (h.includes('pin code') || h.includes('pincode') || h === 'pin') return pincode;
    if (h.includes('product name & quantity') || h.includes('items summary') || h === 'products' || h === 'items') return productSummary;
    if (h.includes('total amount') || h === 'total') return totalAmount;
    if (h.includes('booking amount') || h.includes('advance')) return bookingAmount;
    if (h.includes('payment mode') || h.includes('payment method')) return paymentMode;
    if (h.includes('cod amount') || h.includes('remaining')) return remainingAmount;
    if (h.includes('preferred courier') || h.includes('courier partner')) return courier;
    if (h.includes('payment details') || h.includes('transaction id') || h.includes('razorpay')) return razorpayId;
    if (h.includes('order id')) return order.orderId || '';
    if (h.includes('tracking id') || h.includes('awb')) return trackingId;
    if (h.includes('courier name')) return courier;
    if (h.includes('tracking link') || h.includes('tracking url')) return trackingLink;
    if (h.includes('language')) return language;
    if (h.includes('trigger') || h.includes('order status') || h === 'status') return trigger;
    if (h.includes('cost price')) return '';
    if (h.includes('courier charges') || h.includes('shipping')) return courierCharges;
    if (h.includes('rto charges')) return '';
    if (h.includes('email')) return email;
    if (h.includes('last synced')) return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Fallback: match by DEFAULT_HEADERS position if header text is identical or position matches
    return '';
  });
}

/**
 * Finds the row number (1-indexed) for a given Order ID in the sheet.
 * Dynamically finds which column holds 'Order ID' before scanning.
 */
async function _findRowByOrderId(sheets, sheetTitle, headers, orderId) {
  if (!orderId) return null;

  // Determine column index for 'Order ID'
  let orderIdColIndex = headers.findIndex(h => /order\s*id/i.test(h));
  if (orderIdColIndex === -1) {
    orderIdColIndex = 0; // Default fallback to first column
  }

  const colLetter = _colIndexToLetter(orderIdColIndex);
  const sheetIdToUse = _getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetIdToUse,
    range: `'${sheetTitle}'!${colLetter}:${colLetter}`,
  });

  const rows = res.data.values || [];
  const targetId = orderId.toString().trim().toLowerCase();

  for (let i = 0; i < rows.length; i++) {
    const val = rows[i] && rows[i][0] ? rows[i][0].toString().trim().toLowerCase() : '';
    if (val === targetId) {
      return i + 1; // 1-indexed row number
    }
  }
  return null;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Called when a new order is placed.
 * Safely appends a new row to the sheet without altering existing rows.
 */
exports.appendOrder = async (order) => {
  const sheetIdToUse = _getSheetId();
  if (!sheetIdToUse) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping append.');
    return;
  }

  try {
    const sheets = _getClient();
    const { sheetTitle, headers } = await _ensureSheetAndGetInfo(sheets);

    const user = await _fetchUser(order);
    const enrichedItems = await _enrichItemsWithVariantSize(order.items || []);
    const row = _buildRowForHeaders(
      headers,
      { ...(order.toObject ? order.toObject() : order), items: enrichedItems },
      user
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetIdToUse,
      range: `'${sheetTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    console.log(`[Sheets] ✅ Order ${order.orderId} appended to sheet tab "${sheetTitle}".`);
  } catch (err) {
    // Never throw — sheets failure must never block order placement
    console.error(`[Sheets] ❌ Failed to append order ${order.orderId}:`, err.message);
  }
};

/**
 * Called when an order status or details are updated.
 * Finds the existing row by Order ID and updates that row in-place.
 * If not found, appends it as a new row (never alters other rows).
 */
exports.updateOrderRow = async (order) => {
  const sheetIdToUse = _getSheetId();
  if (!sheetIdToUse) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping update.');
    return;
  }

  try {
    const sheets = _getClient();
    const { sheetTitle, headers } = await _ensureSheetAndGetInfo(sheets);

    const user = await _fetchUser(order);
    const enrichedItems = await _enrichItemsWithVariantSize(order.items || []);
    const row = _buildRowForHeaders(
      headers,
      { ...(order.toObject ? order.toObject() : order), items: enrichedItems },
      user
    );

    const rowNumber = await _findRowByOrderId(sheets, sheetTitle, headers, order.orderId);

    if (rowNumber) {
      const endColLetter = _colIndexToLetter(Math.max(headers.length - 1, row.length - 1));
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetIdToUse,
        range: `'${sheetTitle}'!A${rowNumber}:${endColLetter}${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      console.log(`[Sheets] ✅ Order ${order.orderId} updated at row ${rowNumber} in "${sheetTitle}".`);
    } else {
      // Row not found — append to the end safely
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetIdToUse,
        range: `'${sheetTitle}'!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
      console.log(`[Sheets] ✅ Order ${order.orderId} not found in "${sheetTitle}" — appended as new row.`);
    }
  } catch (err) {
    console.error(`[Sheets] ❌ Failed to update order ${order.orderId}:`, err.message);
  }
};

/**
 * Syncs orders from database to Google Sheets non-destructively.
 * Updates matching order rows in place, or appends new orders to the bottom using batchUpdate to prevent quota exhaustion.
 * NEVER clears or deletes existing rows.
 */
exports.syncAllOrdersToSheet = async () => {
  const sheetIdToUse = _getSheetId();
  if (!sheetIdToUse) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping syncAllOrdersToSheet.');
    return { success: false, message: 'GOOGLE_SHEETS_ID not set' };
  }

  try {
    const Order = require('../models/Order');
    const sheets = _getClient();
    const { sheetTitle, headers } = await _ensureSheetAndGetInfo(sheets);

    console.log('[Sheets] Fetching all orders from database...');
    const orders = await Order.find({})
      .populate({
        path: 'user',
        select: 'firstName lastName phoneNumber alternatePhone email shopName assignedAgent preferredLanguage isPanelCreated source createdVia',
        populate: {
          path: 'assignedAgent',
          select: 'firstName lastName phoneNumber email',
        },
      })
      .sort({ placedAt: 1 })
      .exec();

    console.log(`[Sheets] Found ${orders.length} orders. Processing sync safely...`);

    // Fetch all existing Order IDs from the sheet to match row numbers
    let orderIdColIndex = headers.findIndex(h => /order\s*id/i.test(h));
    if (orderIdColIndex === -1) orderIdColIndex = 0;
    const colLetter = _colIndexToLetter(orderIdColIndex);

    const sheetIdRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetIdToUse,
      range: `'${sheetTitle}'!${colLetter}:${colLetter}`,
    });

    const existingRows = sheetIdRes.data.values || [];
    const orderRowMap = new Map(); // orderId -> 1-based row number

    for (let r = 0; r < existingRows.length; r++) {
      const val = existingRows[r] && existingRows[r][0] ? existingRows[r][0].toString().trim().toLowerCase() : '';
      if (val) {
        orderRowMap.set(val, r + 1);
      }
    }

    // Cache products for variant packaging enrichment
    const productIds = [];
    orders.forEach(o => {
      (o.items || []).forEach(i => {
        const pId = (i.product?._id || i.product)?.toString();
        if (pId) productIds.push(pId);
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

    const batchUpdates = [];
    const rowsToAppend = [];

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

      const row = _buildRowForHeaders(
        headers,
        { ...(order.toObject ? order.toObject() : order), items: enrichedItems },
        order.user
      );

      const targetId = (order.orderId || '').toString().trim().toLowerCase();
      const existingRowNumber = targetId ? orderRowMap.get(targetId) : null;

      if (existingRowNumber) {
        const endColLetter = _colIndexToLetter(Math.max(headers.length - 1, row.length - 1));
        batchUpdates.push({
          range: `'${sheetTitle}'!A${existingRowNumber}:${endColLetter}${existingRowNumber}`,
          values: [row],
        });
      } else {
        rowsToAppend.push(row);
      }
    }

    // Execute in-place updates in batches of 50 to avoid payload size and quota issues
    const BATCH_SIZE = 50;
    for (let i = 0; i < batchUpdates.length; i += BATCH_SIZE) {
      const chunk = batchUpdates.slice(i, i + BATCH_SIZE);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetIdToUse,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: chunk,
        },
      });
    }

    // Append any orders not already in the sheet in a single request
    if (rowsToAppend.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetIdToUse,
        range: `'${sheetTitle}'!A1`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rowsToAppend },
      });
    }

    console.log(`[Sheets] ✅ Sync completed. Updated: ${batchUpdates.length}, Appended: ${rowsToAppend.length}`);
    return { success: true, count: batchUpdates.length + rowsToAppend.length };
  } catch (err) {
    console.error('[Sheets] ❌ Failed to sync all orders:', err.message);
    throw err;
  }
};

