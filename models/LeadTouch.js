const mongoose = require('mongoose');

const leadTouchSchema = new mongoose.Schema({
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  phone: {
    type: String,
    trim: true,
    index: true
  },
  channel: {
    type: String,
    enum: ['lead_form', 'ctwa', 'app_install', 'organic', 'referral'],
    required: true,
    index: true
  },
  metaCampaignId: {
    type: String,
    trim: true,
    index: true
  },
  metaCampaignName: {
    type: String,
    trim: true
  },
  metaAdsetId: {
    type: String,
    trim: true,
    index: true
  },
  metaAdsetName: {
    type: String,
    trim: true
  },
  metaAdId: {
    type: String,
    trim: true,
    index: true
  },
  metaAdName: {
    type: String,
    trim: true
  },
  metaFormId: {
    type: String,
    trim: true,
    index: true
  },
  platform: {
    type: String,
    enum: ['fb', 'ig', 'whatsapp', 'android', 'unknown'],
    default: 'unknown'
  },
  clickIdentifier: {
    type: String,
    trim: true,
    index: true
  },
  formAnswers: {
    type: mongoose.Schema.Types.Mixed
  },
  rawPayload: {
    type: mongoose.Schema.Types.Mixed
  },
  touchedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

leadTouchSchema.index({ lead: 1, touchedAt: 1 });
leadTouchSchema.index({ channel: 1, touchedAt: -1 });

module.exports = mongoose.model('LeadTouch', leadTouchSchema);
