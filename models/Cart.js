const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: true }); // Ensure cart items get their own IDs

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // One cart per user
  },
  items: [cartItemSchema],
  totalAmount: {
    type: Number,
    default: 0
  },
  appliedCoupon: {
    type: String,
    trim: true,
    uppercase: true
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  finalAmount: {
    type: Number,
    default: 0
  },
  freeItems: [{
    name: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    quantity: { type: Number, default: 1 },
    isFree: { type: Boolean, default: true }
  }]
}, {
  timestamps: true
});

const Cart = mongoose.model('Cart', cartSchema);
module.exports = Cart;
