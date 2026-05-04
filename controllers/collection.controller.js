const Collection = require('../models/Collection');
const Product = require('../models/Product');

// Get all active collections
exports.getCollections = async (req, res, next) => {
  try {
    const collections = await Collection.find({ isActive: true })
      .sort({ priority: -1, name: 1 });
    
    res.json({
      success: true,
      collections
    });
  } catch (error) {
    next(error);
  }
};

// Get single collection by slug
exports.getCollectionBySlug = async (req, res, next) => {
  try {
    const collection = await Collection.findOne({ slug: req.params.slug, isActive: true });
    if (!collection) {
      return res.status(404).json({ success: false, message: 'Collection not found' });
    }
    
    res.json({
      success: true,
      collection
    });
  } catch (error) {
    next(error);
  }
};

// Get collections with products (for Home Screen layout)
// This returns collections along with the first few products in each
exports.getCollectionsWithProducts = async (req, res, next) => {
  try {
    const limit = Number(req.query.productLimit) || 10;
    const collections = await Collection.find({ isActive: true })
      .sort({ priority: -1, name: 1 })
      .lean();

    const result = await Promise.all(collections.map(async (col) => {
      const products = await Product.find({ 
        assignedCollections: col.name,
        availabilityStatus: { $ne: 'Out of Stock' } 
      })
      .select('title brandName technicalName thumbnail variants minPrice maxPrice availabilityStatus averageRating')
      .limit(limit)
      .lean();

      return {
        ...col,
        products
      };
    }));

    // Filter out collections that have no products if requested
    const finalResult = req.query.skipEmpty === 'true' 
      ? result.filter(c => c.products.length > 0)
      : result;

    res.json({
      success: true,
      collections: finalResult
    });
  } catch (error) {
    next(error);
  }
};
