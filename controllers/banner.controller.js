
async function syncBannerToCategory(bannerDoc) {
  if (bannerDoc.type === "category_card" && bannerDoc.imageUrl) {
    try {
      const Category = require("../models/Category");
      const mongoose = require("mongoose");
      const target = (bannerDoc.redirectTarget || bannerDoc.title || "").trim();
      if (target) {
        const orConditions = [
          { name: new RegExp(`^${target}$`, "i") },
          { slug: new RegExp(`^${target}$`, "i") }
        ];
        if (mongoose.Types.ObjectId.isValid(target)) {
          orConditions.push({ _id: target });
        }
        await Category.updateMany(
          { $or: orConditions },
          { $set: { bannerImage: bannerDoc.imageUrl } }
        );
      }
    } catch (_) {}
  }
}

const cacheService = require('../utils/cache');
const Banner = require('../models/Banner');
const { uploadToGCS, deleteFromGCS } = require('../utils/gcs');

/**
 * Get all banners with optional filtering
 */
exports.getAllBanners = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === 'true';
    }

    const banners = await Banner.find(filter)
      .sort({ priority: 1, createdAt: -1 })
      .lean();

    res.json({
      success: true,
      count: banners.length,
      banners
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single banner by ID
 */
exports.getBannerById = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id).lean();
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    res.json({
      success: true,
      banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new banner
 */
exports.createBanner = async (req, res, next) => {
  try {
    const { title, priority, type, isActive, redirectType, redirectTarget, imageUrl: bodyImageUrl } = req.body;

    let imageUrl = bodyImageUrl || '';

    // Handle file upload to GCS if image file provided
    if (req.file) {
      const cleanFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destination = `banners/${Date.now()}_${cleanFileName}`;
      imageUrl = await uploadToGCS(req.file.buffer, destination, req.file.mimetype);
    }

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: 'Banner image is required (upload file or provide imageUrl)'
      });
    }

    const banner = new Banner({
      title: title || '',
      imageUrl,
      priority: priority ? parseInt(priority, 10) : 0,
      type: type || 'home',
      isActive: isActive !== undefined ? (isActive === true || isActive === 'true') : true,
      redirectType: redirectType || 'none',
      redirectTarget: redirectTarget || ''
    });

    await banner.save();
    await syncBannerToCategory(banner);
    try { await cacheService.del('categories:hierarchy'); await cacheService.delByPattern('products:*'); } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing banner
 */
exports.updateBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    const { title, priority, type, isActive, redirectType, redirectTarget, imageUrl: bodyImageUrl } = req.body;

    // Handle replacement file upload if provided
    if (req.file) {
      const cleanFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destination = `banners/${Date.now()}_${cleanFileName}`;
      banner.imageUrl = await uploadToGCS(req.file.buffer, destination, req.file.mimetype);
    } else if (bodyImageUrl) {
      banner.imageUrl = bodyImageUrl;
    }

    if (title !== undefined) banner.title = title;
    if (priority !== undefined) banner.priority = parseInt(priority, 10) || 0;
    if (type !== undefined) banner.type = type;
    if (isActive !== undefined) banner.isActive = (isActive === true || isActive === 'true');
    if (redirectType !== undefined) banner.redirectType = redirectType;
    if (redirectTarget !== undefined) banner.redirectTarget = redirectTarget;

    await banner.save();
    await syncBannerToCategory(banner);
    try { await cacheService.del('categories:hierarchy'); await cacheService.delByPattern('products:*'); } catch (_) {}

    res.json({
      success: true,
      message: 'Banner updated successfully',
      banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Toggle banner active status
 */
exports.toggleBannerActive = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    banner.isActive = !banner.isActive;
    await banner.save();
    await syncBannerToCategory(banner);
    try { await cacheService.del('categories:hierarchy'); await cacheService.delByPattern('products:*'); } catch (_) {}

    res.json({
      success: true,
      message: `Banner ${banner.isActive ? 'activated' : 'deactivated'} successfully`,
      banner
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a banner
 */
exports.deleteBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.id);
    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    // Try deleting image from GCS if it's stored in GCS
    if (banner.imageUrl && banner.imageUrl.includes('storage.googleapis.com')) {
      await deleteFromGCS(banner.imageUrl).catch(() => {});
    }

    await Banner.findByIdAndDelete(req.params.id);
    try { await cacheService.del('categories:hierarchy'); await cacheService.delByPattern('products:*'); } catch (_) {}

    res.json({
      success: true,
      message: 'Banner deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};
