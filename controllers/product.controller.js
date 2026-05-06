const productService = require('../services/product.service');
const { processAndUploadProductImage } = require('../utils/gcs');
const mongoose = require('mongoose');
const Collection = require('../models/Collection');
const Product = require('../models/Product');
const Banner = require('../models/Banner');

// Get all products with cursor-based pagination
exports.getProducts = async (req, res, next) => {
  try {
    const { cursor, limit, search, categoryId, subCategoryId, minPrice, maxPrice, isFeatured, collection } = req.query;
    
    const filters = {};
    if (categoryId) filters.categoryId = categoryId;
    if (subCategoryId) filters.subCategoryId = subCategoryId;
    if (isFeatured !== undefined) filters.isFeatured = isFeatured === 'true';
    if (collection) filters.assignedCollections = collection;
    
    if (minPrice) {
      filters.minPrice = { $gte: Number(minPrice) };
    }
    if (maxPrice) {
      filters.maxPrice = { $lte: Number(maxPrice) };
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

// Consolidated Discovery API for Home Screen (BFF Pattern)
exports.getHomeDiscovery = async (req, res, next) => {
  try {
    // 1. Fetch Categories
    const categoriesPromise = productService.getCategoriesHierarchy();
    
    // 2. Fetch Featured Products (Top 10)
    const featuredPromise = productService.getProducts({ isFeatured: true }, { limit: 10 });
    
    // 3. Fetch Collections
    const collectionsPromise = Collection.find({ isActive: true })
      .sort({ priority: -1, name: 1 })
      .lean();

    // 4. Fetch Banners
    const bannersDocs = await Banner.find({ isActive: true, type: 'home' })
      .sort({ priority: 1 })
      .lean();

    const [categories, featuredResult, collections, bannersList] = await Promise.all([
      categoriesPromise,
      featuredPromise,
      collectionsPromise,
      bannersDocs
    ]);

    // Format banners to handle both single-doc arrays and multi-doc structures
    let formattedBanners = [];
    bannersList.forEach(doc => {
      if (doc.homebanners && Array.isArray(doc.homebanners)) {
        doc.homebanners.forEach((url, index) => {
          formattedBanners.push({
            _id: `${doc._id}_${index}`,
            title: `Home Banner ${index + 1}`,
            imageUrl: url,
            priority: index,
            type: 'home',
            redirectType: 'none',
            isActive: true
          });
        });
      } else if (doc.imageUrl) {
        formattedBanners.push(doc);
      }
    });

    // 4. Populate collections with products
    const collectionsWithProducts = await Promise.all(collections.map(async (col) => {
      const products = await Product.find({ 
        assignedCollections: col.name,
        availabilityStatus: { $ne: 'Out of Stock' } 
      })
      .select('title brandName technicalName thumbnail variants minPrice maxPrice availabilityStatus averageRating')
      .limit(10)
      .lean();

      return {
        ...col,
        products
      };
    }));

    res.json({
      success: true,
      banners: formattedBanners,
      categories,
      featuredProducts: featuredResult.products,
      collections: collectionsWithProducts.filter(c => c.products.length > 0)
    });
  } catch (error) {
    next(error);
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
