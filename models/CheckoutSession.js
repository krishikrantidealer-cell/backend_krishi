const mongoose = require('mongoose');

const checkoutSessionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  razorpayOrderId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    variantId: mongoose.Schema.Types.ObjectId,
    title: String,
    vendor: String,
    image: String,
    quantity: Number,
    price: Number,
    variant: String
  }],
  totalAmount: {
    type: Number,
    required: true
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  couponCode: String,
  shippingAddress: {
    name: String,
    phoneNumber: String,
    villageArea: String,
    cityTehsil: String,
    state: String,
    pincode: String
  },
  paymentMethod: {
    type: String,
    enum: ['Online', 'Partial'],
    default: 'Online'
  },
  advanceAmount: Number,
  remainingAmount: Number,
  status: {
    type: String,
    enum: ['Pending', 'Completed', 'Failed'],
    default: 'Pending'
  },
  orderCreated: {
    type: Boolean,
    default: false
  },
  createdOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours expiry
    index: { expires: 0 }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CheckoutSession', checkoutSessionSchema);
