const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  adminEmail: {
    type: String
  },
  action: {
    type: String,
    required: true,
    index: true
  }, // e.g., 'PRODUCT_PRICE_UPDATE'
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  }, // ID of product, order, etc.
  targetModel: {
    type: String
  }, // e.g., 'Product', 'Order'
  changes: {
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed
  },
  ipAddress: String,
  userAgent: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false
});

// TTL Index for audit logs - keep for 1 year (Enterprise standard)
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
