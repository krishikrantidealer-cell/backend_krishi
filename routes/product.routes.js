const express = require('express');
const productController = require('../controllers/product.controller');

const router = express.Router();

/**
 * Public Catalog Routes
 */

// Get all categories and sub-categories
router.get('/categories', productController.getCategories);

// Get all products (with filters)
router.get('/', productController.getProducts);

// Create a new product (with multiple variants)
router.post('/', productController.createProduct);

// Get single product details
router.get('/:id', productController.getProduct);

module.exports = router;
