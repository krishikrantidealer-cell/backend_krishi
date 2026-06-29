const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  user: {
    type: String,
    required: true,
    index: true
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
    index: true
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
