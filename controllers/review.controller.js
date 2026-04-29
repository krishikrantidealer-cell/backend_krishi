const reviewService = require('../services/review.service');

class ReviewController {
  /**
   * Add a review to a product
   * POST /api/products/:productId/reviews
   */
  async addReview(req, res) {
    try {
      const { productId } = req.params;
      const userId = req.user.id;

      const userName = req.user.firstName ? `${req.user.firstName} ${req.user.lastName || ''}`.trim() : 'Verified Buyer';

      const reviewData = {
        reviewerName: userName,
        reviewerEmail: req.user.phoneNumber,
        rating: req.body.rating,
        title: req.body.title,
        body: req.body.body,
        pictureUrls: req.body.pictureUrls || []
      };

      if (!reviewData.rating) {
        return res.status(400).json({ success: false, message: 'Rating is required' });
      }

      const review = await reviewService.addReview(productId, userId, reviewData);

      res.status(201).json({
        success: true,
        message: 'Review added successfully',
        review
      });
    } catch (error) {
      if (error.message === 'You have already reviewed this product') {
        return res.status(400).json({ success: false, message: error.message });
      }
      console.error('Error adding review:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Get all reviews for a product (Cursor Paginated)
   * GET /api/products/:productId/reviews
   */
  async getProductReviews(req, res) {
    try {
      const { productId } = req.params;
      const { cursor, limit } = req.query;

      const result = await reviewService.getProductReviews(productId, {
        cursor,
        limit: parseInt(limit) || 10
      });

      res.status(200).json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Error fetching reviews:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

module.exports = new ReviewController();
