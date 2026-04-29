require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Coupon = require('../models/Coupon');
const Product = require('../models/Product');

const MONGO_URI = process.env.MONGODB_URI;

async function seedCoupons() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    console.log('Clearing old coupons...');
    await Coupon.deleteMany({});

    const couponsArray = [];
    const csvFilePath = path.join(__dirname, 'coupons.csv');

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const typeOfDiscount = row['Type of Discount'] || '';
        const percentageOrAbsolute = row['Percentage OR Absolute'] || '';
        const amountStr = row['Amount'] || '';
        const eligibility = row['Eligibility Criteria'] || '';
        let code = row['Discount Code'] || '';

        // Determine Discount Type
        let discountType = 'Percentage';
        if (typeOfDiscount.includes('Buy X get Y') || amountStr.includes('Free')) {
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

        // Clean up code name (If it's a long sentence, convert to a single word code)
        if (code === 'Get Free Product') code = 'FREECOMBO';

        couponsArray.push({
          code: code.trim().toUpperCase(),
          discountType: discountType,
          discountValue: discountValue,
          minimumPurchaseAmount: parseFloat(row['Minimum Purchase Amount']) || 0,
          maxUsesPerUser: row['Maximum discount uses'] === 'one use per customer' ? 1 : 999,
          isFirstOrderOnly: isFirstOrderOnly,
          _tempFreeProductName: row['Get Y Product'] !== '-' ? row['Get Y Product'] : undefined,
          applicableCollections: row['Products/Collections to Apply Discount'] !== '-' ? row['Products/Collections to Apply Discount'] : undefined,
          canCombine: row['Combine with Other Discounts'] === 'Yes',
          isActive: true
        });
      })
      .on('end', async () => {
        console.log(`Found ${couponsArray.length} coupons to process.`);
        
        for (const coupon of couponsArray) {
          if (coupon._tempFreeProductName) {
            // Try to find a matching product in the DB to get its ID
            const product = await Product.findOne({ title: new RegExp(coupon._tempFreeProductName.split(' ')[0], 'i') });
            if (product) {
              coupon.freeProductId = product._id;
              coupon.freeProductQuantity = 1;
              console.log(`Mapped free product "${coupon._tempFreeProductName}" to ID ${product._id}`);
            } else {
               // Fallback: If no product found, we'll just use a random one for demo purposes
               const randomProduct = await Product.findOne();
               if (randomProduct) {
                 coupon.freeProductId = randomProduct._id;
                 coupon.freeProductQuantity = 1;
                 console.log(`Fallback: Mapped "${coupon._tempFreeProductName}" to random product ID ${randomProduct._id}`);
               }
            }
          }
          delete coupon._tempFreeProductName;
        }

        if (couponsArray.length > 0) {
          await Coupon.insertMany(couponsArray);
          console.log('✅ Coupons seeded successfully!');
        }
        process.exit(0);
      });

  } catch (error) {
    console.error('❌ Failed to seed coupons:', error);
    process.exit(1);
  }
}

seedCoupons();
