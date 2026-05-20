const express = require('express');
const collectionController = require('../controllers/collection.controller');
const { protect } = require('../middlewares/auth.middleware');

const router = express.Router();

// Get list of collections
router.get('/', collectionController.getCollections);

// Get collections with products (Home Screen API)
router.get('/products', collectionController.getCollectionsWithProducts);

// Get specific collection details
router.get('/:slug', collectionController.getCollectionBySlug);

// Create collection (Admin)
router.post('/', protect, collectionController.createCollection);

// Update collection (Admin)
router.put('/:id', protect, collectionController.updateCollection);

// Create sub-collection (Admin)
router.post('/:id/sub', protect, collectionController.createSubCollection);

// Update sub-collection (Admin)
router.put('/:id/sub/:subId', protect, collectionController.updateSubCollection);

// Delete sub-collection (Admin)
router.delete('/:id/sub/:subId', protect, collectionController.deleteSubCollection);

module.exports = router;
