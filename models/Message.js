const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true,
    index: true
  },
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'document', 'audio', 'video', 'template'],
    required: true
  },
  content: {
    type: String,
    trim: true
  },
  mediaUrl: {
    type: String,
    trim: true
  },
  myoperatorMessageId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  // Legacy field — kept for backward compat with old messages, do not use for new messages
  interaktMessageId: {
    type: String,
    sparse: true,
    index: true
  },
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // Null for incoming webhook-delivered messages
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read', 'failed'],
    default: 'sent',
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
