const express = require('express');
const collectionController = require('../controllers/collection.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();

// Get list of collections
router.get('/', collectionController.getCollections);

// Get collections with products (Home Screen API)
router.get('/products', collectionController.getCollectionsWithProducts);

// Get specific collection details
router.get('/:slug', collectionController.getCollectionBySlug);

// Create collection (Admin)
router.post('/', protect, authorizeRoles('admin'), collectionController.createCollection);

// Update collection (Admin)
router.put('/:id', protect, authorizeRoles('admin'), collectionController.updateCollection);

// Delete collection (Admin)
router.delete('/:id', protect, authorizeRoles('admin'), collectionController.deleteCollection);

// Create sub-collection (Admin)
router.post('/:id/sub', protect, authorizeRoles('admin'), upload.single('image'), collectionController.createSubCollection);

// Update sub-collection (Admin)
router.put('/:id/sub/:subId', protect, authorizeRoles('admin'), upload.single('image'), collectionController.updateSubCollection);

// Delete sub-collection (Admin)
router.delete('/:id/sub/:subId', protect, authorizeRoles('admin'), collectionController.deleteSubCollection);

module.exports = router;
