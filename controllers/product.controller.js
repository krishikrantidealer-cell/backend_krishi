const productService = require('../services/product.service');
const { processAndUploadProductImage } = require('../utils/gcs');
const mongoose = require('mongoose');
const Collection = require('../models/Collection');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Category = require('../models/Category');
const cacheService = require('../utils/cache');

const normalizeWord = (w) => {
  return w.toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s$/, ''); // singularize (removes ending 's')
};

const getWords = (str) => {
  return str.split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(normalizeWord)
    .filter(Boolean);
};

const matchSubCollectionToBanner = (subName, banner) => {
  const subNameLower = subName.trim().toLowerCase();
  const titleLower = (banner.title || '').toLowerCase();
  const targetLower = (banner.redirectTarget || '').toLowerCase();
  const urlLower = (banner.imageUrl || '').toLowerCase();
  
  if (
    titleLower.includes(subNameLower) || 
    targetLower === subNameLower || 
    urlLower.includes(`/${subNameLower}.`) || 
    urlLower.includes(`/${subNameLower}%`) ||
    urlLower.includes(`_${subNameLower}`) ||
    urlLower.includes(subNameLower)
  ) {
    return true;
  }
  
  const baseTitle = banner.title.includes('/') ? banner.title.split('/').pop() : banner.title;
  const subWords = getWords(subName);
  const bannerWords = getWords(baseTitle);
  
  if (subWords.length > 0 && bannerWords.length > 0) {
    if (subWords.every(w => bannerWords.includes(w)) || bannerWords.every(w => subWords.includes(w))) {
      return true;
    }
  }
  
  return false;
};

// Get all products with cursor-based pagination
exports.getProducts = async (req, res, next) => {
  try {
    const { cursor, limit, search, categoryId, subCategoryId, minPrice, maxPrice, isFeatured, collection } = req.query;
    
    const filters = {};
    const conditions = [];

    if (categoryId) {
      conditions.push({
        $or: [
          { categoryId: categoryId },
          { categoryIds: categoryId }
        ]
      });
    }
    if (subCategoryId) {
      conditions.push({
        $or: [
          { subCategoryId: subCategoryId },
          { subCategoryIds: subCategoryId }
        ]
      });
    }

    if (conditions.length > 0) {
      filters.$and = conditions;
    }

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
      const subNames = (col.subCollections || []).map(s => s.name);
      const allNames = [col.name, ...subNames];

      const products = await Product.find({ 
        assignedCollections: { $in: allNames },
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

      // Dynamically match subcollection images if they are undefined/null
      const updatedSubCollections = (col.subCollections || []).map(sub => {
        let subImage = sub.image;
        if ((!subImage || subImage === 'undefined' || subImage === 'null') && customCollectionBanners.length > 0) {
          const matchingBanner = customCollectionBanners.find(b => matchSubCollectionToBanner(sub.name, b));
          if (matchingBanner) {
            subImage = matchingBanner.imageUrl;
          }
        }
        return {
          ...sub,
          image: subImage
        };
      });

      return {
        ...col,
        bannerImage,
        subCollections: updatedSubCollections,
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
      collections: collectionsWithProducts
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

    let subCategoriesList = subCategories;
    if (typeof subCategories === 'string') {
      try {
        subCategoriesList = JSON.parse(subCategories);
      } catch (_) {
        subCategoriesList = [];
      }
    }

    const formattedSubCategories = (subCategoriesList || []).map(sub => 
      typeof sub === 'string' ? { name: sub.trim() } : { name: sub.name.trim() }
    );

    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
    const pdfFile = req.files && req.files['cataloguePdf'] ? req.files['cataloguePdf'][0] : null;

    let bannerImage;
    if (imageFile) {
      const { uploadToGCS } = require('../utils/gcs');
      const timestamp = Date.now();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const destination = `categorycardbanners/${slug}_${timestamp}.webp`;
      bannerImage = await uploadToGCS(imageFile.buffer, destination, 'image/webp');
    }

    let cataloguePdf;
    if (pdfFile) {
      const { uploadToGCS } = require('../utils/gcs');
      const timestamp = Date.now();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const destination = `categorycatalogues/${slug}_${timestamp}.pdf`;
      cataloguePdf = await uploadToGCS(pdfFile.buffer, destination, 'application/pdf');
    } else if (req.body.cataloguePdf) {
      cataloguePdf = req.body.cataloguePdf;
    }

    const category = await Category.create({
      name: name.trim(),
      subCategories: formattedSubCategories,
      bannerImage,
      cataloguePdf
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

    let bannerImage;
    if (req.file) {
      const { uploadToGCS } = require('../utils/gcs');
      const timestamp = Date.now();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const destination = `categorycardbanners/sub/${slug}_${timestamp}.webp`;
      bannerImage = await uploadToGCS(req.file.buffer, destination, 'image/webp');
    }

    category.subCategories.push({ name: name.trim(), bannerImage });
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

// Initialize a chunked upload session (Admin)
exports.initChunkedUpload = async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { fileName, totalChunks, categoryName } = req.body;
    if (!fileName || !totalChunks || !categoryName) {
      return res.status(400).json({ success: false, message: 'fileName, totalChunks, and categoryName are required' });
    }

    const uploadId = new mongoose.Types.ObjectId().toString();
    const chunksDir = path.join(__dirname, '../uploads/chunks', uploadId);

    // Create the directory for this upload session
    await fs.promises.mkdir(chunksDir, { recursive: true });

    // Store metadata in a JSON file in the upload folder
    const metadata = {
      fileName,
      totalChunks: parseInt(totalChunks),
      categoryName,
      createdAt: new Date(),
    };
    await fs.promises.writeFile(path.join(chunksDir, 'metadata.json'), JSON.stringify(metadata));

    res.json({
      success: true,
      uploadId,
    });
  } catch (error) {
    next(error);
  }
};

// Upload a single chunk (Admin)
exports.uploadChunk = async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ success: false, message: 'uploadId and chunkIndex are required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No chunk file uploaded' });
    }

    const chunksDir = path.join(__dirname, '../uploads/chunks', uploadId);

    // Check if initialization directory exists
    if (!fs.existsSync(chunksDir)) {
      return res.status(400).json({ success: false, message: 'Upload session not initialized or expired' });
    }

    // Write chunk data to disk named after the chunkIndex
    const chunkPath = path.join(chunksDir, `chunk_${chunkIndex}.tmp`);
    await fs.promises.writeFile(chunkPath, req.file.buffer);

    res.json({
      success: true,
      message: `Chunk ${chunkIndex} uploaded successfully`,
    });
  } catch (error) {
    next(error);
  }
};

// Complete chunked upload: merge chunks and stream to GCS (Admin)
exports.completeChunkedUpload = async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ success: false, message: 'uploadId is required' });
    }

    const chunksDir = path.join(__dirname, '../uploads/chunks', uploadId);

    if (!fs.existsSync(chunksDir)) {
      return res.status(400).json({ success: false, message: 'Upload session not found' });
    }

    // Read metadata
    const metadataPath = path.join(chunksDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      return res.status(400).json({ success: false, message: 'Session metadata missing' });
    }

    const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf-8'));
    const { totalChunks, categoryName } = metadata;

    // Check that all chunk files exist
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunksDir, `chunk_${i}.tmp`);
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ success: false, message: `Missing chunk ${i}` });
      }
    }

    const { bucket } = require('../utils/gcs');
    const timestamp = Date.now();
    const slug = categoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const destination = `categorycatalogues/${slug}_${timestamp}.pdf`;

    const file = bucket.file(destination);

    const gcsStream = file.createWriteStream({
      metadata: { contentType: 'application/pdf' },
      resumable: false,
    });

    await new Promise((resolve, reject) => {
      gcsStream.on('error', (err) => reject(err));
      gcsStream.on('finish', () => resolve());

      (async () => {
        try {
          for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(chunksDir, `chunk_${i}.tmp`);
            const chunkBuffer = await fs.promises.readFile(chunkPath);
            
            if (!gcsStream.write(chunkBuffer)) {
              await new Promise((resolveDrain) => gcsStream.once('drain', resolveDrain));
            }
          }
          gcsStream.end();
        } catch (err) {
          gcsStream.destroy(err);
          reject(err);
        }
      })();
    });

    try {
      await file.makePublic();
    } catch (_) {}

    const fileUrl = `https://storage.googleapis.com/${bucketName}/${file.name}`;

    // Clean up
    await fs.promises.rm(chunksDir, { recursive: true, force: true });

    res.json({
      success: true,
      fileUrl,
    });
  } catch (error) {
    try {
      const fs = require('fs');
      const path = require('path');
      const chunksDir = path.join(__dirname, '../uploads/chunks', req.body.uploadId);
      if (fs.existsSync(chunksDir)) {
        await fs.promises.rm(chunksDir, { recursive: true, force: true });
      }
    } catch (_) {}
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

    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
    const pdfFile = req.files && req.files['cataloguePdf'] ? req.files['cataloguePdf'][0] : null;

    category.name = name.trim();

    // Check if we need to clear or upload a new banner image
    if (imageFile) {
      const { uploadToGCS } = require('../utils/gcs');
      const timestamp = Date.now();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const destination = `categorycardbanners/${slug}_${timestamp}.webp`;
      category.bannerImage = await uploadToGCS(imageFile.buffer, destination, 'image/webp');
    } else if (req.body.bannerImage === '') {
      category.bannerImage = undefined;
    }

    // Check if we need to clear or upload a new catalogue PDF
    if (pdfFile) {
      const { uploadToGCS } = require('../utils/gcs');
      const timestamp = Date.now();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const destination = `categorycatalogues/${slug}_${timestamp}.pdf`;
      category.cataloguePdf = await uploadToGCS(pdfFile.buffer, destination, 'application/pdf');
    } else if (req.body.cataloguePdf === '') {
      category.cataloguePdf = undefined;
    } else if (req.body.cataloguePdf) {
      category.cataloguePdf = req.body.cataloguePdf;
    }

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

    // Unset categoryId/subCategoryId and pull categoryId from categoryIds array for matching products
    const Product = require('../models/Product');
    await Product.updateMany(
      { $or: [{ categoryId: id }, { categoryIds: id }] },
      { 
        $pull: { categoryIds: id },
        $unset: { categoryId: "", subCategoryId: "" }
      }
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

    if (req.file) {
      const { uploadToGCS } = require('../utils/gcs');
      const timestamp = Date.now();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const destination = `categorycardbanners/sub/${slug}_${timestamp}.webp`;
      category.subCategories[subIndex].bannerImage = await uploadToGCS(req.file.buffer, destination, 'image/webp');
    } else if (req.body.bannerImage === '') {
      category.subCategories[subIndex].bannerImage = undefined;
    }

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

    // Unset subCategoryId and pull subCategoryId from subCategoryIds array for matching products
    const Product = require('../models/Product');
    await Product.updateMany(
      { $or: [{ subCategoryId: subId }, { subCategoryIds: subId }] },
      { 
        $pull: { subCategoryIds: subId },
        $unset: { subCategoryId: "" }
      }
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

