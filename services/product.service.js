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

    // Description and specifications are now embedded in the Product model via productData

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
      search
    } = options;

    // Create a unique cache key based on filters and options
    const cacheKey = `products:${JSON.stringify(filters)}:${cursor}:${limit}:${search}`;

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

    // Sort by title alphabetically for search results; by _id for regular listing
    const sortOrder = search ? { title: 1 } : { _id: 1 };

    // 2. Fallback to MongoDB
    const products = await Product.find(query)
      .select('title brandName technicalName vendor thumbnail variants images availabilityStatus averageRating numReviews minPrice maxPrice categoryId subCategoryId categoryIds subCategoryIds assignedCollections tags description isFeatured specifications mediumImages originalImages')
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

    // Invalidate product listing cache
    await cacheService.delByPattern('products:*');

    return product;
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
