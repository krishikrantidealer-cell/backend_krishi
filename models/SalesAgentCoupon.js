const mongoose = require('mongoose');

const overrideSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  productTitle: String,   // Denormalized
  variantSize: String,    // Denormalized
  originalPrice: Number,
  overridePrice: {
    type: Number,
    required: true
  }
});

const salesAgentCouponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  overrides: [overrideSchema],
  isUsed: {
    type: Boolean,
    default: false
  },
  usedInOrderId: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  expiresAt: {
    type: Date
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SalesAgentCoupon', salesAgentCouponSchema);
