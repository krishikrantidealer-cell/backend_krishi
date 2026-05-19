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

// Create a new collection (Admin)
exports.createCollection = async (req, res, next) => {
  try {
    const { name, description, bannerImage, isActive, priority } = req.body;
    
    // Automatically generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const collection = await Collection.create({
      name,
      slug,
      description,
      bannerImage,
      isActive: isActive !== undefined ? isActive : true,
      priority: priority !== undefined ? Number(priority) : 0
    });

    res.status(201).json({
      success: true,
      message: 'Collection created successfully',
      collection
    });
  } catch (error) {
    next(error);
  }
};

// Update an existing collection (Admin)
exports.updateCollection = async (req, res, next) => {
  try {
    const { name, description, bannerImage, isActive, priority } = req.body;
    
    const collection = await Collection.findById(req.params.id);
    if (!collection) {
      return res.status(404).json({ success: false, message: 'Collection not found' });
    }

    const oldName = collection.name;
    const updateData = {};
    
    if (name !== undefined) {
      updateData.name = name;
      updateData.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    if (description !== undefined) updateData.description = description;
    if (bannerImage !== undefined) updateData.bannerImage = bannerImage;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (priority !== undefined) updateData.priority = Number(priority);

    const updatedCollection = await Collection.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    // If name is updated, update matching products as well
    if (name !== undefined && oldName !== name) {
      await Product.updateMany(
        { assignedCollections: oldName },
        { $set: { "assignedCollections.$[elem]": name } },
        { arrayFilters: [{ "elem": oldName }] }
      );
    }

    res.json({
      success: true,
      message: 'Collection updated successfully',
      collection: updatedCollection
    });
  } catch (error) {
    next(error);
  }
};

// Delete a collection (Admin)
exports.deleteCollection = async (req, res, next) => {
  try {
    const collection = await Collection.findByIdAndDelete(req.params.id);
    if (!collection) {
      return res.status(404).json({ success: false, message: 'Collection not found' });
    }

    // Pull the collection name from all products' assignedCollections
    await Product.updateMany(
      { assignedCollections: collection.name },
      { $pull: { assignedCollections: collection.name } }
    );

    res.json({
      success: true,
      message: 'Collection deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

