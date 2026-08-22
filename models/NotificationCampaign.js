const mongoose = require('mongoose');

const templateItemSchema = new mongoose.Schema({
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
  imageUrl: {
    type: String,
    trim: true,
    default: ''
  },
  actionRoute: {
    type: String,
    trim: true,
    default: '/dashboard'
  },
  isEnabled: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const notificationCampaignSchema = new mongoose.Schema({
  segmentKey: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  goal: {
    type: String,
    trim: true,
    default: ''
  },
  category: {
    type: String,
    enum: ['utility', 'marketing', 'kyc', 'order', 'cart', 'seasonal'],
    default: 'marketing'
  },
  isEnabled: {
    type: Boolean,
    default: true,
    index: true
  },
  scheduledTime: {
    type: String, // "HH:mm" 24hr format in IST e.g. "09:00", "11:30"
    required: true,
    default: "09:00",
    trim: true
  },
  mode: {
    type: String,
    enum: ['rotating', 'random', 'pinned'],
    default: 'rotating'
  },
  pinnedTemplateId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  targetRoute: {
    type: String,
    default: '/dashboard',
    trim: true
  },
  templates: [templateItemSchema],
  stats: {
    totalDispatches: { type: Number, default: 0 },
    totalDelivered: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    lastDispatchedCount: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

const NotificationCampaign = mongoose.model('NotificationCampaign', notificationCampaignSchema);

module.exports = NotificationCampaign;
