const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
    index: true
  },
  eventId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  sessionId: {
    type: String,
    index: true
  },
  schemaVersion: {
    type: String,
    default: '1.0.0'
  },
  eventType: {
    type: String,
    required: true,
    index: true
  },
  device: {
    type: String,
    default: 'Unknown Device'
  },
  details: {
    type: String,
    default: ''
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true // Preserved for long-term historical analytics & enterprise pipeline
  },
  role: {
    type: String,
    default: 'unknown'
  }
}, {
  timestamps: true
});

eventSchema.index({ user: 1, timestamp: -1 });
eventSchema.index({ eventType: 1, timestamp: -1 });

const Event = mongoose.model('Event', eventSchema);

module.exports = Event;
