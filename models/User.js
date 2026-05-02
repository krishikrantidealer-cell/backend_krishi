const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
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
    enum: ['user', 'admin'],
    default: 'user'
  },
  // KYC Fields
  userType: {
    type: String,
    enum: ['Retailer and Distributor'],
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
  kycStatus: {
    type: String,
    enum: ['pending', 'submitted', 'verified', 'rejected'],
    default: 'pending'
  },
  isKycComplete: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);

module.exports = User;
