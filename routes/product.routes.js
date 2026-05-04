const express = require('express');
const productController = require('../controllers/product.controller');
const reviewController = require('../controllers/review.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * Public Catalog Routes
 */

// Home Discovery API (Consolidated)
router.get('/discovery', productController.getHomeDiscovery);

// Get all categories and sub-categories
router.get('/categories', productController.getCategories);

// Get all products (with filters)
router.get('/', productController.getProducts);

// Create a new product (with multiple variants)
router.post('/', productController.createProduct);

// Get single product details
router.get('/:id', productController.getProduct);

/**
 * Review Routes
 */
// Get reviews for a product
router.get('/:productId/reviews', reviewController.getProductReviews);

// Add a review to a product (Requires Authentication)
router.post('/:productId/reviews', protect, reviewController.addReview);

module.exports = router;
