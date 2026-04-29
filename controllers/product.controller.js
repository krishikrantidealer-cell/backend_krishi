const productService = require('../services/product.service');
const { processAndUploadProductImage } = require('../utils/gcs');
const mongoose = require('mongoose');

// Get all products with cursor-based pagination
exports.getProducts = async (req, res, next) => {
  try {
    const { cursor, limit, search, categoryId, subCategoryId, minPrice, maxPrice } = req.query;
    
    const filters = {};
    if (categoryId) filters.categoryId = categoryId;
    if (subCategoryId) filters.subCategoryId = subCategoryId;
    
    if (minPrice || maxPrice) {
      filters['variants.price'] = {};
      if (minPrice) filters['variants.price'].$gte = Number(minPrice);
      if (maxPrice) filters['variants.price'].$lte = Number(maxPrice);
    }

    const result = await productService.getProducts(filters, {
      cursor,
      limit: Number(limit) || 20,
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

// Get single product details (combined light + heavy data)
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

// Create a new product (Admin) - Supports automatic image processing into 3 sizes
exports.createProduct = async (req, res, next) => {
  try {
    let productData = req.body;
    
    if (typeof productData.data === 'string') {
      productData = JSON.parse(productData.data);
    }

    // Generate product ID first to create folder structure in GCS
    const productId = new mongoose.Types.ObjectId();
    productData._id = productId;

    // Handle Image Uploads with Processing
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file => 
        processAndUploadProductImage(file.buffer, file.originalname, productId)
      );
      
      const processedImages = await Promise.all(uploadPromises);
      
      // Map images into the new "Blueprint" format
      productData.thumbnail = processedImages[0].thumb; // First image as thumbnail
      productData.mediumImages = processedImages.map(img => img.medium);
      productData.originalImages = processedImages.map(img => img.original);
      productData.images = processedImages.map(img => img.thumb); // For backward compatibility
    }

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

// Standalone method to upload images and get processed URLs
exports.uploadImages = async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const id = productId || new mongoose.Types.ObjectId();

    const uploadPromises = req.files.map(file => 
      processAndUploadProductImage(file.buffer, file.originalname, id)
    );
    
    const processedImages = await Promise.all(uploadPromises);
    
    res.json({
      success: true,
      images: processedImages
    });
  } catch (error) {
    next(error);
  }
};
