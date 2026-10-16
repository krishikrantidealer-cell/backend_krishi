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
  type: {
    type: String,
    enum: [
      'general',
      'lead_assigned',
      'dealer_assigned',
      'unassigned_lead_inflow',
      'task_reminder',
      'task_due_now',
      'task_overdue_digest',
      'kyc_submitted',
      'kyc_verified',
      'kyc_rejected',
      'kyc_sla_breach',
      'order_placed',
      'order_updated',
      'whatsapp_inbound',
      'missed_call',
      'account_blocked',
      'account_deleted'
    ],
    default: 'general',
    index: true
  },
  priority: {
    type: String,
    enum: ['normal', 'high', 'critical'],
    default: 'normal'
  },
  actionRoute: {
    type: String,
    trim: true,
    default: '/'
  },
  entityId: {
    type: String,
    trim: true,
    default: null
  },
  entityType: {
    type: String,
    enum: ['lead', 'dealer', 'order', 'call_log', 'conversation', 'system', null],
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true
});

// Compound index for fast per-user unread & category queries
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, type: 1, entityId: 1, isRead: 1 });

// TTL Index: Automatically delete notifications after 30 days (2592000 seconds)
// This prevents the database from bloating over time.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
