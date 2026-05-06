const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: false,
    trim: true
  },
  imageUrl: {
    type: String,
    required: true,
    trim: true
  },
  priority: {
    type: Number,
    default: 0
  },
  // Maps to your folder types (e.g., 'home', 'category', 'promotional')
  type: {
    type: String,
    default: 'home',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Optional navigation when the banner is tapped
  redirectType: {
    type: String,
    enum: ['category', 'product', 'collection', 'external', 'none'],
    default: 'none'
  },
  redirectTarget: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Banner', bannerSchema);
