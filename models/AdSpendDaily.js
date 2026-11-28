const mongoose = require('mongoose');

const adSpendDailySchema = new mongoose.Schema({
  date: {
    type: String, // YYYY-MM-DD
    required: true,
    index: true
  },
  channel: {
    type: String,
    enum: ['lead_form', 'ctwa', 'app_install'],
    default: 'lead_form',
    index: true
  },
  campaignId: {
    type: String,
    trim: true,
    required: true,
    index: true
  },
  campaignName: {
    type: String,
    trim: true
  },
  adsetId: {
    type: String,
    trim: true,
    default: ''
  },
  adsetName: {
    type: String,
    trim: true
  },
  adId: {
    type: String,
    trim: true,
    default: ''
  },
  adName: {
    type: String,
    trim: true
  },
  spend: {
    type: Number,
    default: 0
  },
  impressions: {
    type: Number,
    default: 0
  },
  leads: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

adSpendDailySchema.index(
  { date: 1, campaignId: 1, adsetId: 1, adId: 1 },
  { unique: true }
);

module.exports = mongoose.model('AdSpendDaily', adSpendDailySchema);
