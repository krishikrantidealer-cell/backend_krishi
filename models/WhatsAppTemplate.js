const mongoose = require('mongoose');

const whatsAppTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  category: {
    type: String,
    enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
    default: 'UTILITY'
  },
  language: {
    type: String,
    default: 'en'
  },
  headerType: {
    type: String,
    enum: ['NONE', 'TEXT', 'IMAGE', 'DOCUMENT', 'VIDEO'],
    default: 'NONE'
  },
  headerText: {
    type: String,
    default: ''
  },
  body: {
    type: String,
    required: true
  },
  footer: {
    type: String,
    default: ''
  },
  buttons: [{
    type: {
      type: String,
      enum: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'],
      default: 'QUICK_REPLY'
    },
    text: String,
    url: String,
    phoneNumber: String
  }],
  sampleVariables: [{
    type: String
  }],
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAUSED'],
    default: 'PENDING_APPROVAL',
    index: true
  },
  providerTemplateId: {
    type: String,
    default: null
  },
  metaRejectionReason: {
    type: String,
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

module.exports = mongoose.model('WhatsAppTemplate', whatsAppTemplateSchema);
