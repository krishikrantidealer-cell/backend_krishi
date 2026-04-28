const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  refreshTokenHash: {
    type: String,
    required: true
  },
  ipAddress: String,
  userAgent: String,
  lastUsed: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Compound index for unique device per user session
sessionSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
