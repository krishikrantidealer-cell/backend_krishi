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
  }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);
