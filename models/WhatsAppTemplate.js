const mongoose = require('mongoose');

const whatsAppTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  title: {
    type: String,
    trim: true,
    default: ''
  },
  category: {
    type: String,
    enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
    default: 'UTILITY',
    index: true
  },
  language: {
    type: String,
    default: 'hi'
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
  headerMediaUrl: {
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
    default: 'APPROVED',
    index: true
  },
  // Multi-Agent Telephony Scoping
  isGlobal: {
    type: Boolean,
    default: false,
    index: true
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  agentPhone: {
    type: String,
    default: ''
  },
  companyId: {
    type: String,
    default: ''
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

// Compound index to ensure uniqueness per agent/WABA account and language
whatsAppTemplateSchema.index({ name: 1, language: 1, agentId: 1 });

module.exports = mongoose.model('WhatsAppTemplate', whatsAppTemplateSchema);
