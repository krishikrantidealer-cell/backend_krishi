const mongoose = require('mongoose');

function getMultiplier(sizeStr) {
  if (!sizeStr) return 1.0;
  // Extract the booking tier volume inside parentheses, e.g. "10" from "100ml (10litre)"
  const match = sizeStr.match(/\(([\d.]+)\s*(?:litre|lit|l|kg|gm|gram|g|k)\)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return 1.0;
}

const variantSchema = new mongoose.Schema({
  size: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  compareAtPrice: { type: Number, min: 0 },
  packVolume: { type: Number, default: 1.0 },
  weight: { type: Number },
  rates: { type: Map, of: String },
  computedPrices: { type: Map, of: String },
  priceTiers: [{
    id: { type: String },
    name: { type: String }
  }],
  basePacking: { type: String }
});

const productSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  brandName: {
    type: String,
    trim: true
  },
  technicalName: {
    type: String,
    trim: true
  },
  thumbnail: {
    type: String,
    trim: true
  },
  vendor: {
    type: String,
    required: true,
    trim: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true
  },
  subCategoryId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  categoryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    index: true
  }],
  subCategoryIds: [{
    type: mongoose.Schema.Types.ObjectId,
    index: true
  }],
  images: [{
    type: String
  }],
  mediumImages: [{
    type: String
  }],
  originalImages: [{
    type: String
  }],
  availabilityStatus: {
    type: String,
    enum: ['In Stock', 'Out of Stock', 'Limited Stock'],
    default: 'In Stock'
  },
  variants: [variantSchema],
  averageRating: {
    type: Number,
    default: 0
  },
  numReviews: {
    type: Number,
    default: 0
  },
  minPrice: {
    type: Number,
    index: true
  },
  maxPrice: {
    type: Number,
    index: true
  },
  assignedCollections: [{
    type: String,
    trim: true
  }],
  isFeatured: {
    type: Boolean,
    default: false
  },
  description: {
    type: String,
    trim: true
  },
  specifications: {
    type: Map,
    of: String
  },
  tags: [{
    type: String,
    trim: true
  }]
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// Automatically calculate min/max price, generate tags, and set default availability before saving
productSchema.pre('save', async function() {
  if (this.categoryIds && this.categoryIds.length > 0) {
    this.categoryId = this.categoryIds[0];
  } else if (this.categoryId) {
    this.categoryIds = [this.categoryId];
  }

  if (this.subCategoryIds && this.subCategoryIds.length > 0) {
    this.subCategoryId = this.subCategoryIds[0];
  } else if (this.subCategoryId) {
    this.subCategoryIds = [this.subCategoryId];
  }
  // Automatically map raw ObjectIDs to Collection/Subcollection Names
  if (this.isModified('assignedCollections') && this.assignedCollections && this.assignedCollections.length > 0) {
    let Collection;
    try {
      Collection = mongoose.models.Collection || mongoose.model('Collection');
    } catch (e) {
      Collection = require('./Collection');
    }
    
    const newAssignments = [];
    for (let c of this.assignedCollections) {
      if (/^[0-9a-fA-F]{24}$/.test(c)) {
        let col = await Collection.findById(c);
        if (col) {
          newAssignments.push(col.name);
          continue;
        }
        col = await Collection.findOne({ 'subCollections._id': c });
        if (col) {
          const sub = col.subCollections.find(s => s._id.toString() === c.toString());
          if (sub) newAssignments.push(sub.name);
          else newAssignments.push(c);
        } else {
          newAssignments.push(c);
        }
      } else {
        newAssignments.push(c);
      }
    }
    this.assignedCollections = [...new Set(newAssignments)];
  }

  if (this.variants && this.variants.length > 0) {
    const prices = this.variants.map(v => v.price);
    this.minPrice = Math.min(...prices);
    this.maxPrice = Math.max(...prices);
  } else {
    this.minPrice = 0;
    this.maxPrice = 0;
  }

  // Auto-generate tags
  const generatedTags = new Set();
  const fieldsToTag = [this.title, this.brandName, this.technicalName, this.vendor];
  fieldsToTag.forEach(field => {
    if (field) {
      field.split(/[\s,/\-\(\)]+/).forEach(w => {
        const clean = w.replace(/[^a-zA-Z0-9]/g, '').trim().toLowerCase();
        if (clean.length > 2) {
          generatedTags.add(clean);
        }
      });
    }
  });
  this.tags = Array.from(generatedTags);

  // Set default availabilityStatus if missing
  if (!this.availabilityStatus) {
    this.availabilityStatus = 'In Stock';
  }
});

// Optimized Indexes for scalable loading
productSchema.index({ availabilityStatus: 1 });
productSchema.index({ isFeatured: 1 });
productSchema.index({ assignedCollections: 1 });
productSchema.index({ createdAt: -1 });
// Search index for title, brandName, technicalName, vendor
productSchema.index({ title: 'text', brandName: 'text', technicalName: 'text', vendor: 'text' });

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
