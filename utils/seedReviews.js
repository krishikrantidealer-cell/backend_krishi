require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Review = require('../models/Review');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/backend_krishi';

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

async function seedReviews() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    console.log('Clearing old reviews...');
    await Review.deleteMany({});
    
    // Drop old indexes like { product: 1, user: 1 } which breaks importing multiple anonymous reviews
    await Review.collection.dropIndexes();
    
    // Fetch all products to create a lookup table by handle
    const products = await Product.find({}, '_id title');
    const productLookup = {};
    
    for (const p of products) {
      // Create a slugified handle for matching
      const handle = slugify(p.title);
      productLookup[handle] = p._id;
      
      // Also store common variations just in case
      // E.g. "EBS Activator" vs "Activator"
      const handleWords = handle.split('-');
      if (handleWords[0] === 'ebs') {
        productLookup[handleWords.slice(1).join('-')] = p._id;
      }
    }

    const csvFilePath = path.join(__dirname, 'reviews.csv');
    const reviewsToInsert = [];
    let unmappedCount = 0;

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const handle = row.product_handle ? row.product_handle.trim() : null;
        if (!handle) return;

        let productId = productLookup[handle];
        
        // Sometimes Shopify appends '-1', '-2' if handles duplicate. Try stripping it.
        if (!productId && handle.match(/-\d+$/)) {
           const stripped = handle.replace(/-\d+$/, '');
           productId = productLookup[stripped];
        }

        // Fuzzy matching logic: check if handle is a substring of the product slug, or vice versa
        if (!productId) {
          for (const pHandle in productLookup) {
            // Remove common prefixes/suffixes to increase match rate
            const cleanHandle = handle.replace('ebs-', '').replace('https-krishibhandar-com-products-', '');
            const cleanPHandle = pHandle.replace('krishikranti-', '').replace('ebs-', '');
            
            if (cleanPHandle.includes(cleanHandle) || cleanHandle.includes(cleanPHandle)) {
              productId = productLookup[pHandle];
              break;
            }
          }
        }

        if (productId) {
          const pictureUrls = row.picture_urls ? row.picture_urls.split(',').map(url => url.trim()).filter(url => url) : [];
          
          reviewsToInsert.push({
            product: productId,
            reviewerName: row.reviewer_name || 'Anonymous User',
            reviewerEmail: row.reviewer_email || '',
            rating: parseInt(row.rating) || 5,
            title: row.title || '',
            body: row.body || '',
            pictureUrls: pictureUrls,
            isVerifiedPurchase: row.curated === 'ok',
            createdAt: row.review_date ? new Date(row.review_date) : new Date()
          });
        } else {
          unmappedCount++;
        }
      })
      .on('end', async () => {
        console.log(`Found ${reviewsToInsert.length} reviews that matched to our products.`);
        console.log(`Failed to map ${unmappedCount} reviews (products might have been renamed or removed).`);

        if (reviewsToInsert.length > 0) {
          await Review.insertMany(reviewsToInsert);
          console.log('✅ Reviews inserted successfully!');

          console.log('Updating average ratings on Products...');
          // Aggregate to find average rating per product
          const aggregations = await Review.aggregate([
            {
              $group: {
                _id: '$product',
                averageRating: { $avg: '$rating' },
                numReviews: { $sum: 1 }
              }
            }
          ]);

          for (const agg of aggregations) {
            await Product.findByIdAndUpdate(agg._id, {
              averageRating: Math.round(agg.averageRating * 10) / 10, // Round to 1 decimal place
              numReviews: agg.numReviews
            });
          }
          console.log('✅ Product ratings updated successfully!');
        }

        process.exit(0);
      });

  } catch (error) {
    console.error('❌ Failed to seed reviews:', error);
    process.exit(1);
  }
}

seedReviews();
