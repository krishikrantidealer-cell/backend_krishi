const productService = require('../services/product.service');

// Get all products with filters
exports.getProducts = async (req, res, next) => {
  try {
    const { page, limit, sortBy, sortOrder, search, categoryId, subCategoryId, minPrice, maxPrice } = req.query;
    
    const filters = {};
    if (categoryId) filters.categoryId = categoryId;
    if (subCategoryId) filters.subCategoryId = subCategoryId;
    
    if (minPrice || maxPrice) {
      filters['variants.price'] = {};
      if (minPrice) filters['variants.price'].$gte = Number(minPrice);
      if (maxPrice) filters['variants.price'].$lte = Number(maxPrice);
    }

    const result = await productService.getProducts(filters, {
      page: Number(page) || 1,
      limit: Number(limit) || 10,
      sortBy,
      sortOrder: Number(sortOrder) || -1,
      search
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};

// Get single product details
exports.getProduct = async (req, res, next) => {
  try {
    const product = await productService.getProductById(req.params.id);
    res.json({
      success: true,
      product
    });
  } catch (error) {
    next(error);
  }
};

// Get category and sub-category hierarchy
exports.getCategories = async (req, res) => {
  try {
    const categories = await productService.getCategoriesHierarchy();
    res.json({
      success: true,
      categories
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
};

// Create a new product (Admin)
exports.createProduct = async (req, res, next) => {
  try {
    const productData = req.body;
    const product = await productService.createProduct(productData);
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    next(error);
  }
};
