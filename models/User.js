const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    index: true
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isProfileComplete: {
    type: Boolean,
    default: false
  },
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  profileImage: {
    type: String, // URL to the profile image
    trim: true
  },
  addressType: {
    type: String,
    enum: ['Shop', 'Home', 'Godown', 'Other'],
    default: 'Home'
  },
  address: {
    villageArea: {
      type: String,
      trim: true
    },
    addressLine2: {
      type: String,
      trim: true
    },
    address2: {
      type: String,
      trim: true
    },
    cityTehsil: {
      type: String,
      trim: true
    },
    state: {
      type: String,
      trim: true
    },
    pincode: {
      type: String,
      trim: true
    }
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'sales'],
    default: 'user'
  },
  // KYC Fields
  userType: {
    type: String,
    enum: ['retailer'],
  },
  shopName: {
    type: String,
    trim: true
  },
  gstNumber: {
    type: String,
    trim: true
  },
  licenceImage: {
    type: String, // URL to the uploaded image
    trim: true
  },
  shopImage: {
    type: String, // URL to the uploaded image
    trim: true
  },
  kycStatus: {
    type: String,
    enum: ['pending', 'submitted', 'processing', 'verified', 'rejected'],
    default: 'pending'
  },
  isKycComplete: {
    type: Boolean,
    default: false
  },
  lastKycReminderSentAt: {
    type: Date
  },
  lastMarketingNotificationSentAt: {
    type: Date,
    index: true
  },
  lastWhatsappSentAt: {
    type: Date,
    index: true
  },
  whatsappSequence: {
    type: Number,
    default: 0
  },
  lastWhatsappType: {
    type: String
  },
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  source: {
    type: String,
    default: 'App'
  },
  deepLinkUrl: {
    type: String,
    default: null
  },
  shippingAddresses: [{
    name: { type: String, required: true, trim: true },
    villageArea: { type: String, required: true, trim: true },
    addressLine2: { type: String, trim: true },
    address2: { type: String, trim: true },
    cityTehsil: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false }
  }],
  fcmToken: {
    type: String,
    trim: true
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  monthlyTarget: {
    type: Number,
    default: 500000
  },
  status: {
    type: String,
    default: 'prospect'
  },
  notes: {
    type: String,
    default: ''
  },
  preferredLanguage: {
    type: String,
    enum: ['en', 'hi', 'ta', 'te', 'mr', 'kn'],
    default: 'en',
    index: true
  },
  notesHistory: [{
    title: { type: String },
    note: { type: String, required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    adminName: { type: String },
    createdAt: { type: Date, default: Date.now },
    author: { type: String },
    timestamp: { type: String },
    type: {
      type: String,
      enum: ['general', 'call', 'meeting', 'followup', 'quote', 'issue'],
      default: 'general'
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    status: { type: String }
  }],
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);

module.exports = User;
