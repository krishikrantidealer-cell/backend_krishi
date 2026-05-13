const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');

const MONGO_URI = process.env.MONGODB_URI;
const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1vDNbsfBIavKC8YHUAOKMaVTlYP9yo69Q0_nLsqxJne8/export?format=csv&gid=0';

async function seedSpreadsheetCoupons() {
  try {
    console.log('🚀 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    console.log('📥 Fetching live coupons from Google Sheet...');
    const response = await axios.get(SPREADSHEET_URL);
    const csvData = response.data;
    console.log('📊 Google Sheet CSV fetched successfully.');

    const couponsArray = [];
    const stream = Readable.from([csvData]);

    stream
      .pipe(csv())
      .on('data', (row) => {
        // Skip empty rows
        if (!row['Discount Code'] || row['Discount Code'] === '-') return;

        const typeOfDiscount = row['Type of Discount'] || '';
        const percentageOrAbsolute = row['Percentage OR Absolute'] || '';
        const amountStr = row['Amount'] || '';
        const eligibility = row['Eligibility Criteria'] || '';
        const getYProduct = row['Get Y Product'] || '';
        let code = row['Discount Code'] || '';

        // Determine Discount Type
        let discountType = 'Percentage';
        if (
          typeOfDiscount.includes('Buy X get Y') ||
          amountStr.toLowerCase().includes('free') ||
          (getYProduct && getYProduct !== '-')
        ) {
          discountType = 'FreeProduct';
        } else if (percentageOrAbsolute === 'Absolute') {
          discountType = 'Absolute';
        }

        // Determine Discount Value
        let discountValue = 0;
        if (discountType !== 'FreeProduct') {
          const match = amountStr.match(/[\d.]+/);
          if (match) discountValue = parseFloat(match[0]);
        }

        // Determine First Order Only
        const isFirstOrderOnly = eligibility.toLowerCase().includes('first order');

        // Clean up code name
        if (code === 'Get Free Product') code = 'FREECOMBO';

        couponsArray.push({
          code: code.trim().toUpperCase(),
          discountType: discountType,
          discountValue: discountValue,
          minimumPurchaseAmount: parseFloat(row['Minimum Purchase Amount'].replace(/[^\d.]/g, '')) || 0,
          maxUsesPerUser: row['Maximum discount uses'] === 'one use per customer' ? 1 : 999,
          isFirstOrderOnly: isFirstOrderOnly,
          _tempFreeProductName: getYProduct !== '-' ? getYProduct : undefined,
          applicableCollections: row['Products/Collections to Apply Discount'] !== '-' ? row['Products/Collections to Apply Discount'] : undefined,
          canCombine: row['Combine with Other Discounts'] === 'Yes',
          isActive: true
        });
      })
      .on('end', async () => {
        console.log(`🔍 Found ${couponsArray.length} coupon(s) from sheet to process.`);

        for (const coupon of couponsArray) {
          if (coupon._tempFreeProductName) {
            // Try to find a matching product in the DB to get its ID
            // Filter out generic words like "Krishikranti" to avoid false positive matches
            const cleanName = coupon._tempFreeProductName.replace(/[^\w\s]/g, '');
            const searchWords = cleanName.split(/\s+/).filter(w => w.length > 2 && w.toLowerCase() !== 'krishikranti');

            console.log(`🔎 Searching Product DB for: "${coupon._tempFreeProductName}" (words: ${searchWords.join(', ')})`);
            
            // Construct a robust query matching ALL parsed keywords (AND logic)
            let product;
            if (searchWords.length > 0) {
              const queryConditions = searchWords.map(word => ({ title: new RegExp(word, 'i') }));
              product = await Product.findOne({ $and: queryConditions });
            }

            // Fallback 1: Match by the first unique keyword (e.g., "Suvirat")
            if (!product && searchWords.length > 0) {
              console.log(`🔍 Try exact match fallback on: "${searchWords[0]}"`);
              product = await Product.findOne({ title: new RegExp(searchWords[0], 'i') });
            }

            if (product) {
              coupon.freeProductId = product._id;
              coupon.freeProductQuantity = 1;
              console.log(`🎯 Mapped free product "${coupon._tempFreeProductName}" to ID ${product._id} (${product.title})`);
            } else {
              // Fallback 2: Random product fallback
              const randomProduct = await Product.findOne();
              if (randomProduct) {
                coupon.freeProductId = randomProduct._id;
                coupon.freeProductQuantity = 1;
                console.log(`⚠️ Warning: Product "${coupon._tempFreeProductName}" not found in DB. Falling back to ID ${randomProduct._id}`);
              }
            }
          }
          delete coupon._tempFreeProductName;
        }

        if (couponsArray.length > 0) {
          for (const coupon of couponsArray) {
            console.log(`💾 Upserting coupon ${coupon.code} in database...`);
            await Coupon.findOneAndUpdate(
              { code: coupon.code },
              coupon,
              { upsert: true, new: true }
            );
          }
          console.log('✅ Spreadsheet Coupon(s) synchronized and stored in database successfully!');
        } else {
          console.log('⚠️ No coupons found in the spreadsheet.');
        }
        process.exit(0);
      });

  } catch (error) {
    console.error('❌ Failed to seed spreadsheet coupons:', error);
    process.exit(1);
  }
}

seedSpreadsheetCoupons();
