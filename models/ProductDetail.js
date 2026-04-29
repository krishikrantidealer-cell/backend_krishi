const mongoose = require('mongoose');

const productDetailSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    unique: true,
    index: true
  },
  description: {
    type: String,
    trim: true
  },
  specifications: {
    type: Object,
    default: {}
  },
  images: {
    medium: [String],
    original: [String]
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ProductDetail', productDetailSchema);
