const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variantId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false
  },
  title: {
    type: String,
    required: true
  },
  vendor: {
    type: String
  },
  technicalName: {
    type: String
  },
  image: {
    type: String
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  costPrice: {
    type: Number,
    default: 0
  },
  variant: {
    type: String,
    default: 'Standard'
  },
  packVolume: {
    type: Number
  },
  basePackingUnit: {
    type: String
  },
  basePacking: {
    type: String
  },
  isCustomBasePack: {
    type: Boolean,
    default: false
  }
});

const shippingAddressSchema = new mongoose.Schema({
  name: String,
  phoneNumber: String,
  villageArea: String,
  addressLine2: String,
  address2: String,
  cityTehsil: String,
  state: String,
  pincode: String
});

const orderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  orderId: {
    type: String,
    unique: true,
    required: true
  },
  items: [orderItemSchema],
  totalAmount: {
    type: Number,
    required: true
  },
  discountAmount: {
    type: Number,
    default: 0
  },
  couponCode: {
    type: String,
    trim: true
  },
  freeItems: [{
    name: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    quantity: { type: Number, default: 1 },
    isFree: { type: Boolean, default: true }
  }],
  shippingAddress: {
    type: shippingAddressSchema,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['Online', 'Partial'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Paid', 'Failed', 'Partially Paid'],
    default: 'Pending'
  },
  razorpayPaymentId: {
    type: String,
    trim: true
  },
  advanceAmount: {
    type: Number,
    default: 0
  },
  remainingAmount: {
    type: Number,
    default: 0
  },
  orderStatus: {
    type: String,
    enum: ['Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'RTO'],
    default: 'Processing'
  },
  courierStatus: {
    type: String,
    trim: true
  },
  awbNumber: {
    type: String,
    trim: true
  },
  courierName: {
    type: String,
    trim: true
  },
  trackingUrl: {
    type: String,
    trim: true
  },
  source: {
    type: String,
    enum: ['app', 'panel'],
    default: 'app'
  },
  placedAt: {
    type: Date,
    default: Date.now
  },
  processingAt: {
    type: Date
  },
  shippedAt: {
    type: Date
  },
  outForDeliveryAt: {
    type: Date
  },
  deliveredAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  },
  rtoAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Optimized Indexes for performance and scalability
orderSchema.index({ orderId: 1 }, { unique: true });
orderSchema.index({ razorpayPaymentId: 1 }, { sparse: true });
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ awbNumber: 1 }, { sparse: true });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ placedAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
