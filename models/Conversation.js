const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true,
    unique: true,
    index: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  status: {
    type: String,
    enum: ['open', 'closed', 'snoozed'],
    default: 'open',
    index: true
  },
  unreadCount: {
    type: Number,
    default: 0
  },
  lastMessage: {
    type: { type: String, enum: ['text', 'image', 'document', 'audio', 'video', 'template'] },
    content: String,
    mediaUrl: String
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  contactType: {
    type: String,
    enum: ['lead', 'dealer', 'customer'],
    default: 'lead',
    index: true
  },
  contactName: {
    type: String,
    trim: true
  },
  contactPhone: {
    type: String,
    trim: true,
    index: true
  }
}, { timestamps: true });

// High performance compound indexes for instant tab queries and sorting
conversationSchema.index({ status: 1, contactType: 1, lastMessageAt: -1 });
conversationSchema.index({ assignedTo: 1, status: 1, contactType: 1, lastMessageAt: -1 });
conversationSchema.index({ status: 1, unreadCount: 1 });
conversationSchema.index({ contactName: 'text', contactPhone: 'text' });

module.exports = mongoose.model('Conversation', conversationSchema);
