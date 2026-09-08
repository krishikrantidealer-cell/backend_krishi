const { google } = require('googleapis');
const User = require('../models/User');
const Product = require('../models/Product');
const { getServiceAccountCredentials } = require('../config/serviceAccountCredentials');

// ─── CONFIGURATION ───────────────────────────────────────────────────────────
function _getSheetId() {
  const envId = (process.env.GOOGLE_SHEETS_ID || '').trim();
  if (envId && envId !== '1Lvlb9TOn6bUjxENfHisCpkhOEhernUktU7H6fxFwUjU') {
    return envId;
  }
  return '19F0kkAqlhgRGyCIzTFu3Inppc6wighXStMZA5yCMu5E';
}

function _getCustomTabName() {
  return process.env.GOOGLE_SHEETS_TAB_NAME || 'Form Responses 1';
}

// Standard 27 Column Headers schema
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

// ─── AUTHENTICATION & CLIENT ──────────────────────────────────────────────────
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

// ─── IN-MEMORY CACHES ────────────────────────────────────────────────────────
let _cachedSheetInfo = null;
let _cachedSheetInfoTime = 0;
const SHEET_INFO_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Map: lowercase orderId -> { rowNumber: number, timestamp: number }
const _orderRowCache = new Map();
const ROW_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
 * Retrieves the spreadsheet metadata and active tab headers with caching.
 */
async function _ensureSheetAndGetInfo(sheets, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedSheetInfo && (now - _cachedSheetInfoTime < SHEET_INFO_TTL_MS)) {
    return _cachedSheetInfo;
  }

  const sheetIdToUse = _getSheetId();
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: sheetIdToUse,
  });

  const allSheets = spreadsheet.data.sheets || [];
  if (allSheets.length === 0) {
    throw new Error('No sheets found in spreadsheet');
  }

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

  _cachedSheetInfo = { sheetTitle, sheetId, headers: existingHeaders };
  _cachedSheetInfoTime = now;
  return _cachedSheetInfo;
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
      const product = productMap[productId];
      if (!product) return item;

      const variant = (product.variants || []).find(
        v => v._id?.toString() === item.variantId?.toString()
      );

      return {
        ...(item.toObject ? item.toObject() : { ...item }),
        variantSize: variant?.size || item.variant || '',
        basePacking: variant?.basePacking || item.basePacking || '',
      };
    });
  } catch (err) {
    console.warn('[Sheets] Variant enrichment skipped:', err.message);
    return items;
  }
}

/**
 * Dynamically builds a row matching the exact header order of the target sheet.
 * PRESERVES existing manual entries (like Cost Price, RTO charges, custom comments)
 * when updating an existing row.
 */
function _buildRowForHeaders(headers, order, user, existingRow = null) {
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
    const packSize = i.variantSize || i.basePacking || i.variant || '';
    return packSize && packSize !== 'Standard'
      ? `${i.title} (${packSize}) - Qty: ${i.quantity}`
      : `${i.title} - Qty: ${i.quantity}`;
  });

  for (const fItem of freeItems) {
    itemsSummaryList.push(`${fItem.name} (Free Gift) - Qty: ${fItem.quantity}`);
  }
  const productSummary = itemsSummaryList.join('\n');

  // Dates & Payment
  const timestamp = order.placedAt
    ? new Date(order.placedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const totalAmount = order.totalAmount ?? 0;
  const bookingAmount = order.advanceAmount ?? 0;
  const remainingAmount = order.remainingAmount ?? (order.paymentMethod === 'Online' ? 0 : totalAmount);
  const paymentMode = order.paymentMethod || 'COD';
  const razorpayId = order.razorpayPaymentId || '';

  // Courier & Tracking
  const courier = order.courierName || 'Delhivery';
  const trackingId = order.awbNumber || '';
  const trackingLink = order.trackingUrl || (trackingId ? `https://www.delhivery.com/track/package/${trackingId}` : '');

  // Dealer tag
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
  const courierCharges = order.shippingCharges ?? order.courierCharge ?? 0;

  // Calculate snapshot cost price if present in order items
  const computedCostPrice = items.reduce((sum, item) => {
    const cp = Number(item.costPrice) || 0;
    const qty = Number(item.quantity) || 1;
    return sum + (cp * qty);
  }, 0);

  // Build row strictly matching each header in the target sheet
  return headers.map((rawHeader, idx) => {
    const h = (rawHeader || '').toString().trim().toLowerCase();
    const existingVal = (existingRow && existingRow[idx] !== undefined) ? existingRow[idx] : '';
    const isFormula = typeof existingVal === 'string' && existingVal.startsWith('=');

    // Always preserve formulas written directly in the sheet
    if (isFormula) {
      return existingVal;
    }

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
    if (h.includes('tracking id') || h.includes('awb')) return trackingId || existingVal;
    if (h.includes('courier name')) return courier || existingVal;
    if (h.includes('tracking link') || h.includes('tracking url')) return trackingLink || existingVal;
    if (h.includes('language')) return language;
    if (h.includes('trigger') || h.includes('order status') || h === 'status') return trigger;

    // Cost Price: use computed if > 0, otherwise preserve manual input from existing row
    if (h.includes('cost price') || h === 'cp') {
      return computedCostPrice > 0 ? computedCostPrice : (existingVal || '');
    }

    // Courier Charges: use order courier charge if set, otherwise preserve manual input
    if (h.includes('courier charges') || h.includes('courier charge') || h.includes('shipping')) {
      return courierCharges > 0 ? courierCharges : (existingVal !== '' ? existingVal : 0);
    }

    // Profit: if total and cost price are available, calculate Net Profit: Total - CP - Courier
    if (h.includes('profit margin') || h.includes('margin %') || h.includes('margin')) {
      const activeCp = computedCostPrice > 0 ? computedCostPrice : (Number(existingRow?.[headers.findIndex(hdr => /cost\s*price/i.test(hdr))]) || 0);
      const activeCourier = courierCharges > 0 ? courierCharges : (Number(existingRow?.[headers.findIndex(hdr => /courier\s*charge/i.test(hdr))]) || 0);
      if (totalAmount > 0 && activeCp > 0) {
        const netProfit = totalAmount - activeCp - activeCourier;
        const marginPct = ((netProfit / totalAmount) * 100).toFixed(2);
        return `${marginPct}%`;
      }
      return existingVal || '';
    }

    if (h === 'profit' || h.includes('net profit') || h.includes('gross profit')) {
      const activeCp = computedCostPrice > 0 ? computedCostPrice : (Number(existingRow?.[headers.findIndex(hdr => /cost\s*price/i.test(hdr))]) || 0);
      const activeCourier = courierCharges > 0 ? courierCharges : (Number(existingRow?.[headers.findIndex(hdr => /courier\s*charge/i.test(hdr))]) || 0);
      if (totalAmount > 0 && activeCp > 0) {
        return Math.round((totalAmount - activeCp - activeCourier) * 100) / 100;
      }
      return existingVal || '';
    }

    // RTO Charges / Manual fields: preserve existing manual entry if present
    if (h.includes('rto charges') || h.includes('rto charge')) {
      return existingVal || '';
    }

    if (h.includes('email')) return email;
    if (h.includes('last synced')) return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    // Fallback for custom staff columns: PRESERVE existing value
    return existingVal || '';
  });
}

/**
 * Finds the row number (1-indexed) for a given Order ID in the sheet.
 * Uses cached row number if available.
 */
async function _findRowByOrderId(sheets, sheetTitle, headers, orderId) {
  if (!orderId) return null;
  const targetId = orderId.toString().trim().toLowerCase();

  // Check cache first
  const cached = _orderRowCache.get(targetId);
  if (cached && (Date.now() - cached.timestamp < ROW_CACHE_TTL_MS)) {
    return cached.rowNumber;
  }

  // Determine column index for 'Order ID'
  let orderIdColIndex = headers.findIndex(h => /order\s*id/i.test(h));
  if (orderIdColIndex === -1) {
    orderIdColIndex = 0;
  }

  const colLetter = _colIndexToLetter(orderIdColIndex);
  const sheetIdToUse = _getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetIdToUse,
    range: `'${sheetTitle}'!${colLetter}:${colLetter}`,
  });

  const rows = res.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    const val = rows[i] && rows[i][0] ? rows[i][0].toString().trim().toLowerCase() : '';
    if (val) {
      _orderRowCache.set(val, { rowNumber: i + 1, timestamp: Date.now() });
      if (val === targetId) {
        return i + 1;
      }
    }
  }
  return null;
}

// ─── RATE-LIMITED TASK QUEUE WITH EXPONENTIAL RETRIES ──────────────────────────
const _syncQueue = [];
let _isProcessingQueue = false;
const RATE_LIMIT_DELAY_MS = 600; // ~100 requests per minute max limit buffer

async function _enqueueTask(taskFn, taskName = 'SheetsTask') {
  return new Promise((resolve, reject) => {
    _syncQueue.push({ taskFn, taskName, resolve, reject, retries: 0 });
    _processQueue();
  });
}

async function _processQueue() {
  if (_isProcessingQueue || _syncQueue.length === 0) return;
  _isProcessingQueue = true;

  while (_syncQueue.length > 0) {
    const item = _syncQueue.shift();
    try {
      const result = await item.taskFn();
      item.resolve(result);
    } catch (err) {
      const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
      const isTransient = isRateLimit || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';

      if (isTransient && item.retries < 3) {
        item.retries += 1;
        const delay = isRateLimit ? 5000 * item.retries : 2000 * item.retries;
        console.warn(`[SheetsQueue] ⚠️ Retrying ${item.taskName} (attempt ${item.retries}) after ${delay}ms: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        _syncQueue.unshift(item); // Reinsert at front of queue
      } else {
        console.error(`[SheetsQueue] ❌ Failed ${item.taskName} permanently:`, err.message);
        item.reject(err);
      }
    }

    // Rate-limit throttle between requests
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  _isProcessingQueue = false;
}

// ─── CORE OPERATIONS (WRAPPED IN QUEUE) ────────────────────────────────────────

async function _performAppendOrder(order) {
  const sheetIdToUse = _getSheetId();
  if (!sheetIdToUse) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping append.');
    return;
  }

  const sheets = _getClient();
  const { sheetTitle, headers } = await _ensureSheetAndGetInfo(sheets);

  const user = await _fetchUser(order);
  const enrichedItems = await _enrichItemsWithVariantSize(order.items || []);
  const row = _buildRowForHeaders(
    headers,
    { ...(order.toObject ? order.toObject() : order), items: enrichedItems },
    user
  );

  const appendRes = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetIdToUse,
    range: `'${sheetTitle}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  // Extract newly appended row number from updatedRange if available
  const updatedRange = appendRes.data?.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+):/i);
  if (match && match[1] && order.orderId) {
    const rowNum = parseInt(match[1], 10);
    _orderRowCache.set(order.orderId.toString().trim().toLowerCase(), { rowNumber: rowNum, timestamp: Date.now() });
  }

  console.log(`[Sheets] ✅ Order ${order.orderId} appended to sheet tab "${sheetTitle}".`);
}

async function _performUpdateOrderRow(order) {
  const sheetIdToUse = _getSheetId();
  if (!sheetIdToUse) {
    console.warn('[Sheets] GOOGLE_SHEETS_ID not set — skipping update.');
    return;
  }

  const sheets = _getClient();
  const { sheetTitle, headers } = await _ensureSheetAndGetInfo(sheets);

  const rowNumber = await _findRowByOrderId(sheets, sheetTitle, headers, order.orderId);

  // Fetch existing row values to preserve manual data columns
  let existingRow = null;
  const endColLetter = _colIndexToLetter(Math.max(headers.length - 1, DEFAULT_HEADERS.length - 1));

  if (rowNumber) {
    try {
      const existingRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetIdToUse,
        range: `'${sheetTitle}'!A${rowNumber}:${endColLetter}${rowNumber}`,
      });
      existingRow = (existingRes.data.values && existingRes.data.values[0]) || null;
    } catch (e) {
      console.warn(`[Sheets] Could not fetch existing row ${rowNumber} values:`, e.message);
    }
  }

  const user = await _fetchUser(order);
  const enrichedItems = await _enrichItemsWithVariantSize(order.items || []);
  const row = _buildRowForHeaders(
    headers,
    { ...(order.toObject ? order.toObject() : order), items: enrichedItems },
    user,
    existingRow
  );

  if (rowNumber) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetIdToUse,
      range: `'${sheetTitle}'!A${rowNumber}:${endColLetter}${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
    console.log(`[Sheets] ✅ Order ${order.orderId} updated at row ${rowNumber} in "${sheetTitle}" (manual columns preserved).`);
  } else {
    // Row not found — append to the end safely
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetIdToUse,
      range: `'${sheetTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    const updatedRange = appendRes.data?.updates?.updatedRange || '';
    const match = updatedRange.match(/!A(\d+):/i);
    if (match && match[1] && order.orderId) {
      const rowNum = parseInt(match[1], 10);
      _orderRowCache.set(order.orderId.toString().trim().toLowerCase(), { rowNumber: rowNum, timestamp: Date.now() });
    }
    console.log(`[Sheets] ✅ Order ${order.orderId} not found in "${sheetTitle}" — appended as new row.`);
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Called when a new order is placed.
 * Appends a new row via the rate-limited, retrying queue.
 */
exports.appendOrder = async (order) => {
  return _enqueueTask(() => _performAppendOrder(order), `appendOrder(${order?.orderId})`)
    .catch(err => {
      console.error(`[Sheets] ❌ Append order error handled:`, err.message);
    });
};

/**
 * Called when an order status or details are updated.
 * Finds existing row, preserves manual data, and updates in-place via queue.
 */
exports.updateOrderRow = async (order) => {
  return _enqueueTask(() => _performUpdateOrderRow(order), `updateOrderRow(${order?.orderId})`)
    .catch(err => {
      console.error(`[Sheets] ❌ Update order error handled:`, err.message);
    });
};

/**
 * Syncs all orders from database to Google Sheets safely and non-destructively.
 * Preserves existing manual columns, updates in-place, and appends missing orders.
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
    const { sheetTitle, headers } = await _ensureSheetAndGetInfo(sheets, true);

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

    console.log(`[Sheets] Found ${orders.length} orders in DB. Reading existing sheet rows...`);

    // Fetch all existing rows to preserve manual fields and map orderId -> rowNumber
    const endColLetter = _colIndexToLetter(Math.max(headers.length - 1, DEFAULT_HEADERS.length - 1));
    const allRowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetIdToUse,
      range: `'${sheetTitle}'!A1:${endColLetter}`,
    });

    const allRows = allRowsRes.data.values || [];
    let orderIdColIndex = headers.findIndex(h => /order\s*id/i.test(h));
    if (orderIdColIndex === -1) orderIdColIndex = 0;

    const orderRowMap = new Map(); // orderId -> { rowNumber, rowData }
    for (let r = 1; r < allRows.length; r++) {
      const rowData = allRows[r];
      const val = rowData && rowData[orderIdColIndex] ? rowData[orderIdColIndex].toString().trim().toLowerCase() : '';
      if (val) {
        orderRowMap.set(val, { rowNumber: r + 1, rowData });
        _orderRowCache.set(val, { rowNumber: r + 1, timestamp: Date.now() });
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
          variantSize: variant?.size || item.variant || '',
          basePacking: variant?.basePacking || item.basePacking || '',
        };
      });

      const targetId = (order.orderId || '').toString().trim().toLowerCase();
      const existingEntry = targetId ? orderRowMap.get(targetId) : null;
      const existingRow = existingEntry ? existingEntry.rowData : null;

      const row = _buildRowForHeaders(
        headers,
        { ...(order.toObject ? order.toObject() : order), items: enrichedItems },
        order.user,
        existingRow
      );

      if (existingEntry) {
        batchUpdates.push({
          range: `'${sheetTitle}'!A${existingEntry.rowNumber}:${endColLetter}${existingEntry.rowNumber}`,
          values: [row],
        });
      } else {
        rowsToAppend.push(row);
      }
    }

    // Execute in-place updates in batches of 50 to stay within limits
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
      // Small pause between chunks to avoid rate limiting
      if (i + BATCH_SIZE < batchUpdates.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Append any orders not already in the sheet
    if (rowsToAppend.length > 0) {
      for (let i = 0; i < rowsToAppend.length; i += BATCH_SIZE) {
        const chunk = rowsToAppend.slice(i, i + BATCH_SIZE);
        await sheets.spreadsheets.values.append({
          spreadsheetId: sheetIdToUse,
          range: `'${sheetTitle}'!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: chunk },
        });
        if (i + BATCH_SIZE < rowsToAppend.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }

    console.log(`[Sheets] ✅ Sync completed safely. Updated: ${batchUpdates.length}, Appended: ${rowsToAppend.length}`);
    return { success: true, count: batchUpdates.length + rowsToAppend.length };
  } catch (err) {
    console.error('[Sheets] ❌ Failed to sync all orders:', err.message);
    throw err;
  }
};
