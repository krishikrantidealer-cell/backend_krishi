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
    trim: true
  },
  wabaMessageId: {
    type: String,
    trim: true
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
  replyTo: {
    messageId: { type: String },
    senderName: { type: String },
    content: { type: String },
    mediaUrl: { type: String }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

// High performance compound indexes for instant chat history pagination and status lookups
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ conversationId: 1, direction: 1, status: 1 });
messageSchema.index({ myoperatorMessageId: 1 }, { sparse: true });
messageSchema.index({ wabaMessageId: 1 }, { sparse: true });

module.exports = mongoose.model('Message', messageSchema);
