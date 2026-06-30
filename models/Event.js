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
    index: true,
    expires: '90d' // Automatic cleanup: raw events are purged after 90 days
  },
  role: {
    type: String,
    default: 'unknown'
  }
}, {
  timestamps: true
});

const Event = mongoose.model('Event', eventSchema);

module.exports = Event;
