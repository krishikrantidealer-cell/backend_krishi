const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['utility', 'marketing'],
    default: 'utility'
  },
  actionRoute: {
    type: String,
    trim: true
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// TTL Index: Automatically delete notifications after 30 days (2592000 seconds)
// This prevents the database from bloating over time.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
