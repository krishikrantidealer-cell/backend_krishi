const productService = require('../services/product.service');
const { processAndUploadProductImage } = require('../utils/gcs');
const mongoose = require('mongoose');
const Collection = require('../models/Collection');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Category = require('../models/Category');
const cacheService = require('../utils/cache');

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
    const categoriesPromise = productService.getCategoriesHierarchy();
    
    const featuredPromise = productService.getProducts({ isFeatured: true }, { limit: 10 });
    
    const collectionsPromise = Collection.find({ isActive: true })
      .sort({ priority: -1, name: 1 })
      .lean();

    const bannersDocs = await Banner.find({ isActive: true, type: { $in: ['home', 'category', 'category_card', 'custom_collections', 'best_offers'] } })
      .sort({ priority: 1 })
      .lean();

    const [categories, featuredResult, collections, bannersList] = await Promise.all([
      categoriesPromise,
      featuredPromise,
      collectionsPromise,
      bannersDocs
    ]);

    // Filter custom collections banners
    const customCollectionBanners = bannersList.filter(b => b.type === 'custom_collections');

    // Format banners to handle both single-doc arrays and multi-doc structures
    let formattedHomeBanners = [];
    let formattedCategoryBanners = [];
    let formattedCategoryCardBanners = [];
    let bestOffersBanners = [];
    bannersList.forEach(doc => {
      if (doc.homebanners && Array.isArray(doc.homebanners)) {
        doc.homebanners.forEach((url, index) => {
          formattedHomeBanners.push({
            _id: `${doc._id}_home_${index}`,
            title: `Home Banner ${index + 1}`,
            imageUrl: url,
            priority: index,
            type: 'home',
            redirectType: 'none',
            isActive: true
          });
        });
      }
      if (doc.categorybanners && Array.isArray(doc.categorybanners)) {
        doc.categorybanners.forEach((url, index) => {
          formattedCategoryBanners.push({
            _id: `${doc._id}_category_${index}`,
            title: `Category Banner ${index + 1}`,
            imageUrl: url,
            priority: index,
            type: 'category',
            redirectType: 'none',
            isActive: true
          });
        });
      }
      if (doc.categorycardbanners && Array.isArray(doc.categorycardbanners)) {
        doc.categorycardbanners.forEach((url, index) => {
          formattedCategoryCardBanners.push({
            _id: `${doc._id}_card_${index}`,
            title: `Category Card Banner ${index + 1}`,
            imageUrl: url,
            priority: index,
            type: 'category_card',
            redirectType: 'none',
            isActive: true
          });
        });
      }
      if (doc.bestoffersbanners && Array.isArray(doc.bestoffersbanners)) {
        doc.bestoffersbanners.forEach((url, index) => {
          bestOffersBanners.push({
            _id: `${doc._id}_best_offer_${index}`,
            title: `Best Offer Banner ${index + 1}`,
            imageUrl: url,
            priority: index,
            type: 'best_offers',
            redirectType: 'none',
            isActive: true
          });
        });
      }
      
      if (doc.imageUrl) {
        if (doc.type === 'home') {
          formattedHomeBanners.push(doc);
        } else if (doc.type === 'category') {
          formattedCategoryBanners.push(doc);
        } else if (doc.type === 'category_card') {
          formattedCategoryCardBanners.push(doc);
        } else if (doc.type === 'best_offers') {
          bestOffersBanners.push(doc);
        }
      }
    });

    const collectionsWithProducts = await Promise.all(collections.map(async (col) => {
      const products = await Product.find({ 
        assignedCollections: col.name,
        availabilityStatus: { $ne: 'Out of Stock' } 
      })
      .select('title brandName technicalName thumbnail variants minPrice maxPrice availabilityStatus averageRating')
      .limit(10)
      .lean();

      // Find matching custom collection banner to set as the shopbycrop/collection bannerImage
      let bannerImage = col.bannerImage;
      if ((!bannerImage || bannerImage === 'undefined' || bannerImage === 'null') && customCollectionBanners.length > 0) {
        const colNameLower = col.name.trim().toLowerCase();
        const matchingBanner = customCollectionBanners.find(b => {
          const titleLower = (b.title || '').toLowerCase();
          const targetLower = (b.redirectTarget || '').toLowerCase();
          const urlLower = (b.imageUrl || '').toLowerCase();
          return titleLower.includes(colNameLower) || 
                 targetLower === colNameLower || 
                 urlLower.includes(`/${colNameLower}.`) || 
                 urlLower.includes(`/${colNameLower}%`) ||
                 urlLower.includes(`_${colNameLower}`) ||
                 urlLower.includes(colNameLower);
        });
        if (matchingBanner) {
          bannerImage = matchingBanner.imageUrl;
        }
      }

      return {
        ...col,
        bannerImage,
        products
      };
    }));

    res.json({
      success: true,
      banners: formattedHomeBanners,
      categoryBanners: formattedCategoryBanners,
      categoryCardBanners: formattedCategoryCardBanners,
      bestOffersBanners,
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

// Update an existing product (Admin)
exports.updateProduct = async (req, res, next) => {
  try {
    let updateData = req.body;
    
    if (typeof updateData.data === 'string') {
      updateData = JSON.parse(updateData.data);
    }

    const productId = req.params.id;

    // keepImages: URLs of existing images the admin wants to retain
    const keepImages = Array.isArray(updateData.keepImages) ? updateData.keepImages : [];
    const keepMedium = Array.isArray(updateData.keepMediumImages) ? updateData.keepMediumImages : [];
    const keepOriginal = Array.isArray(updateData.keepOriginalImages) ? updateData.keepOriginalImages : [];
    delete updateData.keepImages;
    delete updateData.keepMediumImages;
    delete updateData.keepOriginalImages;

    // Handle Image Uploads if any new files are uploaded
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file => 
        processAndUploadProductImage(file.buffer, file.originalname, productId)
      );
      
      const processedImages = await Promise.all(uploadPromises);

      // Merge kept existing images with newly uploaded images
      const allThumbs = [...keepImages, ...processedImages.map(img => img.thumb)];
      const allMedium = [...keepMedium, ...processedImages.map(img => img.medium)];
      const allOriginal = [...keepOriginal, ...processedImages.map(img => img.original)];

      updateData.thumbnail = allThumbs[0]; // First image is always thumbnail
      updateData.images = allThumbs;
      updateData.mediumImages = allMedium;
      updateData.originalImages = allOriginal;
    } else if (keepImages.length > 0) {
      // No new uploads but kept images may have changed (e.g. some deleted)
      updateData.thumbnail = keepImages[0];
      updateData.images = keepImages;
      if (keepMedium.length > 0) updateData.mediumImages = keepMedium;
      if (keepOriginal.length > 0) updateData.originalImages = keepOriginal;
    }

    const product = await productService.updateProduct(productId, updateData);
    res.json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    next(error);
  }
};

// Delete a product (Admin)
exports.deleteProduct = async (req, res, next) => {
  try {
    const productId = req.params.id;
    await productService.deleteProduct(productId);
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Create a new category (Admin)
exports.createCategory = async (req, res, next) => {
  try {
    const { name, subCategories } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }
    
    // Check if category already exists
    const existing = await Category.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Category already exists' });
    }

    const formattedSubCategories = (subCategories || []).map(sub => 
      typeof sub === 'string' ? { name: sub.trim() } : { name: sub.name.trim() }
    );

    const category = await Category.create({
      name: name.trim(),
      subCategories: formattedSubCategories
    });

    try {
      await cacheService.del('categories:hierarchy');
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category
    });
  } catch (error) {
    next(error);
  }
};

// Create a new sub-category inside a category (Admin)
exports.createSubCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check if sub-category already exists
    const subNameLower = name.trim().toLowerCase();
    const existingSub = category.subCategories.find(sub => sub.name.toLowerCase() === subNameLower);
    if (existingSub) {
      return res.status(400).json({ success: false, message: 'Subcategory already exists' });
    }

    category.subCategories.push({ name: name.trim() });
    await category.save();

    try {
      await cacheService.del('categories:hierarchy');
    } catch (_) {}

    res.status(201).json({
      success: true,
      message: 'Subcategory added successfully',
      category
    });
  } catch (error) {
    next(error);
  }
};

// Update a category (Admin)
exports.updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Check if name is unique
    const existing = await Category.findOne({ 
      name: new RegExp(`^${name.trim()}$`, 'i'),
      _id: { $ne: id }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Another category with this name already exists' });
    }

    category.name = name.trim();
    await category.save();

    try {
      await cacheService.del('categories:hierarchy');
    } catch (_) {}

    res.json({
      success: true,
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    next(error);
  }
};

// Delete a category (Admin)
exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    await Category.findByIdAndDelete(id);

    // Unset categoryId and subCategoryId for matching products
    const Product = require('../models/Product');
    await Product.updateMany(
      { categoryId: id },
      { $unset: { categoryId: "", subCategoryId: "" } }
    );

    try {
      await cacheService.del('categories:hierarchy');
    } catch (_) {}

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Update a sub-category (Admin)
exports.updateSubCategory = async (req, res, next) => {
  try {
    const { id, subId } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Subcategory name is required' });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const subIndex = category.subCategories.findIndex(sub => sub._id.toString() === subId);
    if (subIndex === -1) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    // Check if new subcategory name already exists in this category
    const subNameLower = name.trim().toLowerCase();
    const duplicate = category.subCategories.find((sub, idx) => idx !== subIndex && sub.name.toLowerCase() === subNameLower);
    if (duplicate) {
      return res.status(400).json({ success: false, message: 'Subcategory with this name already exists in this category' });
    }

    category.subCategories[subIndex].name = name.trim();
    await category.save();

    try {
      await cacheService.del('categories:hierarchy');
    } catch (_) {}

    res.json({
      success: true,
      message: 'Subcategory updated successfully',
      category
    });
  } catch (error) {
    next(error);
  }
};

// Delete a sub-category (Admin)
exports.deleteSubCategory = async (req, res, next) => {
  try {
    const { id, subId } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    const subIndex = category.subCategories.findIndex(sub => sub._id.toString() === subId);
    if (subIndex === -1) {
      return res.status(404).json({ success: false, message: 'Subcategory not found' });
    }

    category.subCategories.splice(subIndex, 1);
    await category.save();

    // Unset subCategoryId for matching products
    const Product = require('../models/Product');
    await Product.updateMany(
      { subCategoryId: subId },
      { $unset: { subCategoryId: "" } }
    );

    try {
      await cacheService.del('categories:hierarchy');
    } catch (_) {}

    res.json({
      success: true,
      message: 'Subcategory deleted successfully',
      category
    });
  } catch (error) {
    next(error);
  }
};

