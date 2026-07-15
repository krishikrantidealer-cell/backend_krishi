const Product = require('../models/Product');
const Category = require('../models/Category');
const cacheService = require('../utils/cache');

class ProductService {
  /**
   * Create a new product and its details
   */
  async createProduct(productData) {
    if (!productData.variants || productData.variants.length === 0) {
      throw new Error('A product must have at least one variant.');
    }

    // 1. Create the lightweight Product first
    const product = await Product.create({
      ...productData,
      thumbnail: productData.thumbnail || (productData.images && productData.images.length > 0 ? productData.images[0] : null)
    });

    // Resolve custom order collisions (auto-shifting)
    if (product.customOrders) {
      await this.resolveOrderCollisions(product._id, product.customOrders);
    }

    // Invalidate product listing cache
    await cacheService.delByPattern('products:*');

    return product;
  }

  /**
   * High-Performance Cursor-Based Pagination with Redis Caching
   */
  async getProducts(filters = {}, options = {}) {
    const {
      cursor,
      limit = 20,
      search,
      contextId
    } = options;

    // Create a unique cache key based on filters and options
    const cacheKey = `products:${JSON.stringify(filters)}:${cursor}:${limit}:${search}:${contextId || ''}`;

    // 1. Try to get from cache (skip for search queries — regex results shouldn't be cached)
    if (!search) {
      const cachedData = await cacheService.get(cacheKey);
      if (cachedData) return cachedData;
    }

    const query = { ...filters };

    if (cursor) {
      query._id = { $gt: cursor };
    }

    if (search) {
      // Sanitize input to prevent ReDoS attacks by escaping regex special chars
      const sanitize = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Split into tokens and strip empty strings (handles multiple spaces)
      const tokens = search.trim().split(/\s+/).filter(Boolean).map(sanitize);

      // AND logic: every token must match at least one searchable field
      const tokenConditions = tokens.map((token) => {
        const re = new RegExp(token, 'i');
        return {
          $or: [
            { title: re },
            { brandName: re },
            { technicalName: re },
            { vendor: re },
          ],
        };
      });

      query.$and = [...(query.$and || []), ...tokenConditions];
    }

    if (contextId) {
      const mongoose = require('mongoose');

      // Recursively cast 24-character hex strings to Mongoose ObjectIds
      // because MongoDB aggregation does not automatically perform schema casting.
      const castToObjectId = (val) => {
        if (typeof val === 'string' && /^[0-9a-fA-F]{24}$/.test(val)) {
          try {
            return new mongoose.Types.ObjectId(val);
          } catch (_) {
            return val;
          }
        }
        return val;
      };

      const traverseAndCast = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (typeof val === 'string') {
            obj[key] = castToObjectId(val);
          } else if (Array.isArray(val)) {
            obj[key] = val.map(castToObjectId);
            val.forEach(traverseAndCast);
          } else if (typeof val === 'object') {
            traverseAndCast(val);
          }
        }
      };

      traverseAndCast(query);

      if (query._id && typeof query._id.$gt === 'string') {
        try {
          query._id.$gt = new mongoose.Types.ObjectId(query._id.$gt);
        } catch (_) {}
      }

      const pipeline = [
        { $match: query },
        {
          $addFields: {
            matchedOrder: {
              $ifNull: [
                { $getField: { field: contextId, input: "$customOrders" } },
                1000000
              ]
            }
          }
        },
        {
          $sort: { matchedOrder: 1, order: 1, _id: 1 }
        },
        {
          $limit: limit
        },
        {
          $project: {
            title: 1,
            brandName: 1,
            technicalName: 1,
            vendor: 1,
            thumbnail: 1,
            variants: 1,
            images: 1,
            availabilityStatus: 1,
            averageRating: 1,
            numReviews: 1,
            minPrice: 1,
            maxPrice: 1,
            categoryId: 1,
            subCategoryId: 1,
            categoryIds: 1,
            subCategoryIds: 1,
            assignedCollections: 1,
            tags: 1,
            description: 1,
            isFeatured: 1,
            specifications: 1,
            mediumImages: 1,
            originalImages: 1,
            order: 1,
            customOrders: 1
          }
        }
      ];

      const products = await Product.aggregate(pipeline);

      // Populate references since aggregation returns raw documents
      await Product.populate(products, [
        { path: 'categoryId' },
        { path: 'categoryIds' }
      ]);

      const nextCursor = products.length > 0 ? products[products.length - 1]._id : null;

      const result = {
        products,
        nextCursor,
        limit
      };

      if (!search) {
        await cacheService.set(cacheKey, result, 300);
      }

      return result;
    }

    // Sort by title alphabetically for search results; by order then _id for regular listing
    const sortOrder = search ? { title: 1 } : { order: 1, _id: 1 };

    // 2. Fallback to MongoDB
    const products = await Product.find(query)
      .select('title brandName technicalName vendor thumbnail variants images availabilityStatus averageRating numReviews minPrice maxPrice categoryId subCategoryId categoryIds subCategoryIds assignedCollections tags description isFeatured specifications mediumImages originalImages order customOrders')
      .populate('categoryId')
      .populate('categoryIds')
      .sort(sortOrder)
      .limit(limit)
      .lean();

    const nextCursor = products.length > 0 ? products[products.length - 1]._id : null;

    const result = {
      products,
      nextCursor,
      limit
    };

    // 3. Store in cache for 5 minutes (skip for search queries)
    if (!search) {
      await cacheService.set(cacheKey, result, 300);
    }

    return result;
  }

  /**
   * Get Full Product Details (Combined)
   */
  async getProductById(id) {
    const product = await Product.findById(id).populate('categoryId');
    if (!product) throw new Error('Product not found');

    return product;
  }

  async getCategoriesHierarchy() {
    const cacheKey = 'categories:hierarchy';
    try {
      const cached = await cacheService.get(cacheKey);
      if (cached) return cached;
    } catch (_) { }

    const mongoose = require('mongoose');
    const categories = await Category.find({}).lean();

    // Dynamically fallback to matching category card banners from seeded Banners collection if missing
    const missingBanners = categories.some(cat => !cat.bannerImage);
    if (missingBanners) {
      try {
        const Banner = mongoose.models.Banner || mongoose.model('Banner');
        const bannersDocs = await Banner.find({ isActive: true, type: 'category_card' }).lean();

        const categoryCardBanners = [];
        bannersDocs.forEach(doc => {
          if (doc.categorycardbanners && Array.isArray(doc.categorycardbanners)) {
            doc.categorycardbanners.forEach((url, index) => {
              categoryCardBanners.push({
                title: `Category Card Banner ${index + 1}`,
                imageUrl: url,
                priority: index,
                redirectTarget: doc.redirectTarget
              });
            });
          }
          if (doc.imageUrl) {
            categoryCardBanners.push(doc);
          }
        });

        categories.forEach(cat => {
          if (!cat.bannerImage) {
            const cleanName = cat.name.trim().toLowerCase();
            const cleanNameNoHyphen = cleanName.replaceAll('-', '').replaceAll(' ', '');

            // Try to match by target or title
            let matchedBanner = categoryCardBanners.find(b => {
              const titleLower = (b.title || '').toLowerCase();
              const targetLower = (b.redirectTarget || '').toLowerCase();
              return titleLower.includes(cleanName) ||
                targetLower === cleanName ||
                titleLower.includes(cleanNameNoHyphen);
            });

            if (!matchedBanner) {
              // Try matching by image URL path keywords
              matchedBanner = categoryCardBanners.find(b => {
                const urlLower = (b.imageUrl || '').toLowerCase();
                return urlLower.includes(`/${cleanName}.`) ||
                  urlLower.includes(`/${cleanName}%`) ||
                  urlLower.includes(`_${cleanName}`) ||
                  urlLower.includes(cleanName) ||
                  urlLower.includes(cleanNameNoHyphen);
              });
            }

            if (matchedBanner) {
              cat.bannerImage = matchedBanner.imageUrl;
            }
          }
        });
      } catch (err) {
        console.error('Error matching category banners:', err);
      }
    }

    try {
      await cacheService.set(cacheKey, categories, 86400); // Cache for 24 hours
    } catch (_) { }

    return categories;
  }

  /**
   * Update a product and invalidate cache
   */
  async updateProduct(id, updateData) {
    const product = await Product.findById(id);
    if (!product) throw new Error('Product not found');

    Object.assign(product, updateData);
    await product.save();

    // Resolve custom order collisions (auto-shifting)
    if (updateData.customOrders) {
      await this.resolveOrderCollisions(product._id, updateData.customOrders);
    }

    // Invalidate product listing cache
    await cacheService.delByPattern('products:*');

    return product;
  }

  /**
   * Automatically resolve custom order collisions in context by shifting conflicting ranks
   */
  async resolveOrderCollisions(productId, customOrders) {
    if (!customOrders || typeof customOrders !== 'object') return;

    for (const [contextId, newOrder] of Object.entries(customOrders)) {
      if (newOrder === undefined || newOrder === null || isNaN(Number(newOrder))) continue;

      const targetOrder = Number(newOrder);
      const safeKey = contextId.replace(/\./g, '_dot_');

      // Find all OTHER products that have this same contextId in their customOrders
      const conflictingProducts = await Product.find({
        _id: { $ne: productId },
        [`customOrders.${safeKey}`]: { $exists: true, $ne: null }
      });

      // Sort conflicting products by their current rank in this context
      conflictingProducts.sort((a, b) => {
        const valAVal = a.customOrders.get ? a.customOrders.get(safeKey) : a.customOrders[safeKey];
        const valBVal = b.customOrders.get ? b.customOrders.get(safeKey) : b.customOrders[safeKey];
        return Number(valAVal) - Number(valBVal);
      });

      // Shift them: if we find any product with rank >= targetOrder, we increment it.
      let currentShiftValue = targetOrder;
      const bulkOps = [];

      for (const p of conflictingProducts) {
        const pOrderVal = p.customOrders.get ? p.customOrders.get(safeKey) : p.customOrders[safeKey];
        const pOrder = Number(pOrderVal);

        if (pOrder >= currentShiftValue) {
          bulkOps.push({
            updateOne: {
              filter: { _id: p._id },
              update: { $set: { [`customOrders.${safeKey}`]: pOrder + 1 } }
            }
          });
          currentShiftValue = pOrder + 1;
        }
      }

      if (bulkOps.length > 0) {
        await Product.bulkWrite(bulkOps);
        console.log(`[OrderCollision] Resolved collisions for context "${contextId}" at rank ${targetOrder}. Shifted ${bulkOps.length} products.`);
      }
    }
  }

  /**
   * Delete a product and invalidate cache
   */
  async deleteProduct(id) {
    const product = await Product.findByIdAndDelete(id);
    if (!product) throw new Error('Product not found');

    // Invalidate product listing cache
    await cacheService.delByPattern('products:*');

    return product;
  }
}

module.exports = new ProductService();
