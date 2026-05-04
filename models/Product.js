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
  brandName: {
    type: String,
    trim: true
  },
  technicalName: {
    type: String,
    trim: true
  },
  thumbnail: {
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
  },
  minPrice: {
    type: Number,
    index: true
  },
  maxPrice: {
    type: Number,
    index: true
  }
}, {
  timestamps: true
});

// Automatically calculate min/max price before saving
productSchema.pre('save', function(next) {
  if (this.variants && this.variants.length > 0) {
    const prices = this.variants.map(v => v.price);
    this.minPrice = Math.min(...prices);
    this.maxPrice = Math.max(...prices);
  } else {
    this.minPrice = 0;
    this.maxPrice = 0;
  }
  next();
});

// Optimized Indexes for scalable loading
productSchema.index({ availabilityStatus: 1 });
productSchema.index({ createdAt: -1 });
// Search index for title, brandName, technicalName, vendor
productSchema.index({ title: 'text', brandName: 'text', technicalName: 'text', vendor: 'text' });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
