const express = require('express');
const collectionController = require('../controllers/collection.controller');

const router = express.Router();

// Get list of collections
router.get('/', collectionController.getCollections);

// Get collections with products (Home Screen API)
router.get('/products', collectionController.getCollectionsWithProducts);

// Get specific collection details
router.get('/:slug', collectionController.getCollectionBySlug);

module.exports = router;
