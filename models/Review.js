const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Nullable if the review was imported from CSV without an account
  },
  reviewerName: {
    type: String,
    required: true,
    trim: true
  },
  reviewerEmail: {
    type: String,
    trim: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    trim: true
  },
  body: {
    type: String,
    trim: true
  },
  pictureUrls: [{
    type: String
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: true // Assume true for imported ones marked 'ok'
  }
}, {
  timestamps: true
});

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
