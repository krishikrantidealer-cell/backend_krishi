const Review = require('../models/Review');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const cacheService = require('../utils/cache');

class ReviewService {
  /**
   * Add a new review to a product
   */
  async addReview(productId, userId, reviewData) {
    const existingReview = await Review.findOne({ product: productId, user: userId });
    if (existingReview) {
      throw new Error('You have already reviewed this product');
    }

    const review = await Review.create({
      product: productId,
      user: userId,
      reviewerName: reviewData.reviewerName,
      reviewerEmail: reviewData.reviewerEmail,
      rating: reviewData.rating,
      title: reviewData.title,
      body: reviewData.body,
      pictureUrls: reviewData.pictureUrls || [],
      isVerifiedPurchase: true
    });

    // Recalculate rating and clear cache
    await this.updateProductRating(productId);
    await cacheService.del(`reviews:${productId}:*`);
    await cacheService.delByPattern('products:*'); // Average rating on product list changed

    return review;
  }

  /**
   * High-Performance Cursor-Based Reviews
   */
  async getProductReviews(productId, options = {}) {
    const { cursor, limit = 10 } = options;
    const cacheKey = `reviews:${productId}:${cursor || 'start'}:${limit}`;

    // 1. Try Cache
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const query = { product: productId };
    if (cursor) {
      query._id = { $lt: cursor }; // Reviews usually show newest first, so we look for older IDs
    }

    // 2. Database Fetch
    const reviews = await Review.find(query)
      .sort({ _id: -1 }) // Newest first
      .limit(limit)
      .populate('user', 'name avatar');

    const nextCursor = reviews.length > 0 ? reviews[reviews.length - 1]._id : null;
    
    const result = {
      reviews,
      nextCursor,
      limit
    };

    // 3. Store in Cache (10 mins)
    await cacheService.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Helper function to recalculate a Product's average rating
   */
  async updateProductRating(productId) {
    const aggregations = await Review.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(productId) } },
      {
        $group: {
          _id: '$product',
          averageRating: { $avg: '$rating' },
          numReviews: { $sum: 1 }
        }
      }
    ]);

    if (aggregations.length > 0) {
      await Product.findByIdAndUpdate(productId, {
        averageRating: Math.round(aggregations[0].averageRating * 10) / 10,
        numReviews: aggregations[0].numReviews
      });
    } else {
      await Product.findByIdAndUpdate(productId, {
        averageRating: 0,
        numReviews: 0
      });
    }
  }
}

module.exports = new ReviewService();
