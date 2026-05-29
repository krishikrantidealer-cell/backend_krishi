const express = require('express');
const productController = require('../controllers/product.controller');
const reviewController = require('../controllers/review.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();

/**
 * Public Catalog Routes
 */

// Home Discovery API (Consolidated)
router.get('/discovery', productController.getHomeDiscovery);

// Get all categories and sub-categories
router.get('/categories', productController.getCategories);

// Chunked Upload Routes for Categories Catalogues
router.post('/categories/upload/init', protect, authorizeRoles('admin'), productController.initChunkedUpload);
router.post('/categories/upload/chunk', protect, authorizeRoles('admin'), upload.single('file'), productController.uploadChunk);
router.post('/categories/upload/complete', protect, authorizeRoles('admin'), productController.completeChunkedUpload);

// Create a new category
router.post('/categories', protect, authorizeRoles('admin'), upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'cataloguePdf', maxCount: 1 }
]), productController.createCategory);

// Create a new sub-category inside a category
router.post('/categories/:id/subcategories', protect, authorizeRoles('admin'), upload.single('image'), productController.createSubCategory);

// Update a category
router.put('/categories/:id', protect, authorizeRoles('admin'), upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'cataloguePdf', maxCount: 1 }
]), productController.updateCategory);

// Delete a category
router.delete('/categories/:id', protect, authorizeRoles('admin'), productController.deleteCategory);

// Update a sub-category
router.put('/categories/:id/subcategories/:subId', protect, authorizeRoles('admin'), upload.single('image'), productController.updateSubCategory);

// Delete a sub-category
router.delete('/categories/:id/subcategories/:subId', protect, authorizeRoles('admin'), productController.deleteSubCategory);

// Get all products (with filters)
router.get('/', productController.getProducts);

// Create a new product (with multiple variants)
router.post('/', protect, authorizeRoles('admin'), upload.array('images', 10), productController.createProduct);

// Update a product
router.put('/:id', protect, authorizeRoles('admin'), upload.array('images', 10), productController.updateProduct);

// Delete a product
router.delete('/:id', protect, authorizeRoles('admin'), productController.deleteProduct);

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
