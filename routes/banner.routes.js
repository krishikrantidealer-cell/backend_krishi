const express = require('express');
const bannerController = require('../controllers/banner.controller');
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();

// Get all banners (Public / Authenticated)
router.get('/', bannerController.getAllBanners);

// Get single banner by ID
router.get('/:id', bannerController.getBannerById);

// Create new banner (Admin only)
router.post('/', protect, authorizeRoles('admin'), upload.single('image'), bannerController.createBanner);

// Update banner (Admin only)
router.put('/:id', protect, authorizeRoles('admin'), upload.single('image'), bannerController.updateBanner);

// Toggle banner active status (Admin only)
router.patch('/:id/toggle', protect, authorizeRoles('admin'), bannerController.toggleBannerActive);

// Delete banner (Admin only)
router.delete('/:id', protect, authorizeRoles('admin'), bannerController.deleteBanner);

module.exports = router;
