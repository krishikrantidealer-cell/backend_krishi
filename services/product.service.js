const Product = require('../models/Product');
const Category = require('../models/Category');

class ProductService {
  async createProduct(productData) {
    // Make sure at least one variant is provided
    if (!productData.variants || productData.variants.length === 0) {
      throw new Error('A product must have at least one variant.');
    }
    const product = await Product.create(productData);
    return product;
  }

  async getProducts(filters = {}, options = {}) {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = -1,
      search
    } = options;

    const query = { ...filters };

    if (search) {
      query.$text = { $search: search };
    }

    const products = await Product.find(query)
      .populate('categoryId', 'name')
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Product.countDocuments(query);

    return {
      products,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async getProductById(id) {
    const product = await Product.findById(id);
    if (!product) throw new Error('Product not found');
    return product;
  }

  async updateProduct(id, updateData) {
    const product = await Product.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!product) throw new Error('Product not found');
    return product;
  }

  async deleteProduct(id) {
    const product = await Product.findByIdAndDelete(id);
    if (!product) throw new Error('Product not found');
    return product;
  }

  async getCategoriesHierarchy() {
    return await Category.find({});
  }
}

module.exports = new ProductService();
