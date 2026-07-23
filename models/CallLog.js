const mongoose = require('mongoose');

/**
 * CallLog — stores only METADATA, never raw audio/binary.
 *
 * Architecture:
 *   Operator (MyOperator) → Webhook → Save CallLog metadata to MongoDB
 *
 * What we store:     providerCallId, direction, duration, status, recordingUrl, metadata
 * What we DON'T:     MP3/WAV audio blobs (those stay with the operator's CDN/storage)
 *
 * The recordingUrl points to MyOperator's hosted recording.
 * If you need long-term retention, schedule a job to copy URLs to S3/R2 before they expire.
 */
const callLogSchema = new mongoose.Schema({
  // ── Provider Reference ───────────────────────────────────────────────────────
  providerCallId: {
    type: String,
    index: true,
    sparse: true
  },
  callId: {          // legacy / alias — keep for backward compat
    type: String,
    index: true,
    sparse: true
  },

  // ── Direction ────────────────────────────────────────────────────────────────
  direction: {
    type: String,
    enum: ['inbound', 'outbound'],
    default: 'outbound',
    index: true
  },

  // ── Parties ──────────────────────────────────────────────────────────────────
  customerPhone: {
    type: String,
    required: true,
    index: true
  },
  agentPhone: {
    type: String
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    index: true,
    default: null
  },

  // ── Call Outcome ─────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['initiated', 'dialing', 'ringing', 'answered', 'missed', 'busy', 'failed', 'ended', 'no-answer'],
    default: 'initiated',
    index: true
  },
  durationSeconds: {
    type: Number,
    default: 0
  },
  disposition: {
    type: String        // operator-provided disposition e.g. "ANSWERED", "NO_ANSWER"
  },

  // ── Recording (URL only — no binary blobs) ──────────────────────────────────
  recordingUrl: {
    type: String,       // CDN/hosted URL from MyOperator. NOT stored locally.
    default: null
  },
  recordingId: {
    type: String,       // MyOperator's internal recording ID for API lookups
    default: null
  },

  // ── Notes & Tags ─────────────────────────────────────────────────────────────
  callSummary: {
    type: String
  },
  notes: {
    type: String
  },
  tags: {
    type: [String],
    default: []
  },

  // ── Extra provider data (raw webhook payload subset) ─────────────────────────
  metadata: {
    type: Object,
    default: {}
  }
}, {
  timestamps: true
});

// ── Compound Indexes for CRM queries ─────────────────────────────────────────
callLogSchema.index({ customerPhone: 1, createdAt: -1 });
callLogSchema.index({ agentId: 1, createdAt: -1 });
callLogSchema.index({ direction: 1, status: 1, createdAt: -1 });
callLogSchema.index({ contactId: 1, createdAt: -1 });

module.exports = mongoose.model('CallLog', callLogSchema);
