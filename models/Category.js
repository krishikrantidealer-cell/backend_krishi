const mongoose = require('mongoose');

const subCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  bannerImage: {
    type: String,
    trim: true
  }
});

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  bannerImage: {
    type: String,
    trim: true
  },
  cataloguePdf: {
    type: String,
    trim: true
  },
  subCategories: [subCategorySchema]
}, {
  timestamps: true
});

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
