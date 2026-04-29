const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: { 
    type: String, 
    required: true, 
    unique: true, 
    uppercase: true, 
    trim: true 
  },
  discountType: { 
    type: String, 
    enum: ['Percentage', 'Absolute', 'FreeProduct'], 
    required: true 
  },
  discountValue: { 
    type: Number, 
    default: 0 
  }, // E.g., 3 for 3%, 20 for 20%, 0 for FreeProduct
  minimumPurchaseAmount: { 
    type: Number, 
    default: 0 
  },
  maxUsesPerUser: { 
    type: Number, 
    default: 1 
  }, // From "one use per customer"
  isFirstOrderOnly: { 
    type: Boolean, 
    default: false 
  }, // From Eligibility Criteria
  freeProductId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }, // For "Buy X get Y"
  freeProductQuantity: {
    type: Number,
    default: 1
  },
  applicableCollections: {
    type: String
  }, // "All Collections" or specific
  canCombine: {
    type: Boolean,
    default: false
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { 
  timestamps: true 
});

module.exports = mongoose.model('Coupon', couponSchema);
