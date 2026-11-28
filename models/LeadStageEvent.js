const mongoose = require('mongoose');

const leadStageEventSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  stage: {
    type: String,
    enum: [
      'New',
      'Contacted',
      'Interested',
      'KYC submitted',
      'KYC verified',
      'First order',
      'Repeat order',
      'Disqualified'
    ],
    required: true,
    index: true
  },
  dispositionReason: {
    type: String,
    trim: true
  },
  agent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  capiSent: {
    type: Boolean,
    default: false
  },
  capiResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  changedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

leadStageEventSchema.index({ lead: 1, changedAt: -1 });

module.exports = mongoose.model('LeadStageEvent', leadStageEventSchema);
