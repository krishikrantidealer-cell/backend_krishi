const Product = require('../models/Product');
const ProductDetail = require('../models/ProductDetail');
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

    // 2. Create the heavy ProductDetail
    await ProductDetail.create({
      productId: product._id,
      description: productData.description || productData.body || '',
      images: {
        medium: productData.mediumImages || [],
        original: productData.originalImages || []
      },
      specifications: productData.specifications || {}
    });

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

    // 1. Try to get from cache
    const cachedData = await cacheService.get(cacheKey);
    if (cachedData) return cachedData;

    const query = { ...filters };

    if (cursor) {
      query._id = { $gt: cursor };
    }

    if (search) {
      query.$text = { $search: search };
    }

    // 2. Fallback to MongoDB
    const products = await Product.find(query)
      .select('title brandName technicalName vendor thumbnail variants availabilityStatus averageRating numReviews')
      .sort({ _id: 1 })
      .limit(limit);

    const nextCursor = products.length > 0 ? products[products.length - 1]._id : null;

    const result = {
      products,
      nextCursor,
      limit
    };

    // 3. Store in cache for 5 minutes
    await cacheService.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Get Full Product Details (Combined)
   */
  async getProductById(id) {
    const product = await Product.findById(id).lean();
    if (!product) throw new Error('Product not found');

    const details = await ProductDetail.findOne({ productId: id }).lean();

    return {
      ...product,
      details: details || {}
    };
  }

  async getCategoriesHierarchy() {
    return await Category.find({});
  }

  /**
   * Update a product and invalidate cache
   */
  async updateProduct(id, updateData) {
    const product = await Product.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!product) throw new Error('Product not found');

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

    // Also delete associated details
    await ProductDetail.deleteOne({ productId: id });

    // Invalidate product listing cache
    await cacheService.delByPattern('products:*');

    return product;
  }
}

module.exports = new ProductService();
