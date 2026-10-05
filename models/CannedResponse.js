const mongoose = require('mongoose');

const cannedResponseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  shortcut: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  message: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: 'General',
    enum: ['General', 'Sales', 'Support', 'Logistics', 'Finance']
  },
  tags: [{
    type: String
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isGlobal: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('CannedResponse', cannedResponseSchema);
