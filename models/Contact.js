const mongoose = require('mongoose');

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

module.exports = mongoose.model('Contact', contactSchema);
