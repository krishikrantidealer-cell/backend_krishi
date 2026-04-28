const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  size: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  weight: { type: Number } // in kg or as specified
});

const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    trim: true
  },
  vendor: {
    type: String,
    required: true,
    trim: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true
  },
  subCategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  tags: [{
    type: String
  }],
  images: [{
    type: String
  }],
  availabilityStatus: {
    type: String,
    enum: ['In Stock', 'Out of Stock', 'Limited Stock'],
    default: 'In Stock'
  },
  variants: [variantSchema],
  averageRating: {
    type: Number,
    default: 0
  },
  numReviews: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Search index for title, vendor and body
productSchema.index({ title: 'text', vendor: 'text', body: 'text' });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
