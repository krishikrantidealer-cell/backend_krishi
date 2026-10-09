const mongoose = require('mongoose');
const { normalizeIndianPhone } = require('../utils/phone');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: 'WhatsApp User'
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  preferredLanguage: {
    type: String,
    enum: ['en', 'hi', 'ta', 'te', 'mr', 'kn'],
    default: 'en',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Strict phone normalization pre-save hook
contactSchema.pre('save', function() {
  if (this.phone) {
    this.phone = normalizeIndianPhone(this.phone);
  }
});

contactSchema.index({ assignedTo: 1, phone: 1 });
contactSchema.index({ tags: 1 });

module.exports = mongoose.model('Contact', contactSchema);
