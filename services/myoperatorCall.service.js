const axios = require('axios');
const CallLog = require('../models/CallLog');
const Contact = require('../models/Contact');

/**
 * MyOperatorCallService
 *
 * Handles outbound OBD calls and recording URL lookups via MyOperator APIs.
 *
 * Architecture (URL-only pattern):
 *   - We NEVER store MP3/WAV audio.
 *   - We store only: providerCallId, direction, duration, status, recordingUrl, recordingId.
 *   - recordingUrl → points to MyOperator's CDN. Audio lives there, not in our DB.
 *   - If MyOperator retains recordings for only 30–90 days, consider scheduling a job to
 *     copy URLs to S3/R2 before they expire.
 */
class MyOperatorCallService {
  constructor() {
    this.obdBaseUrl    = 'https://obd-api.myoperator.co/obd-api-v1';
    this.callingBaseUrl = 'https://developers.myoperator.co';
    this.callingXApiKey  = process.env.MYOPERATOR_CALLING_X_API_KEY;
    this.callingSecretKey = process.env.MYOPERATOR_CALLING_SECRET_KEY;
    this.callingToken    = process.env.MYOPERATOR_CALLING_TOKEN;
  }

  getObdHeaders() {
    return {
      'x-api-key':    this.callingXApiKey  || '',
      'secret-key':   this.callingSecretKey || '',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Trigger an Outbound OBD Call (connects sales agent → customer/dealer).
   * Saves a CallLog with metadata only (no audio stored).
   */
  async triggerOutboundCall({ agentId, customerPhone, agentPhone }) {
    const cleanCustomerPhone = customerPhone.replace(/\D/g, '').replace(/^91/, '');
    const cleanAgentPhone    = agentPhone ? agentPhone.replace(/\D/g, '').replace(/^91/, '') : '';

    const payload = {
      customer_number: cleanCustomerPhone,
      agent_number:    cleanAgentPhone || undefined
    };

    console.log(`[MyOperator OBD] Triggering outbound call to: ${cleanCustomerPhone}`);

    let responseData = null;

    if (this.callingXApiKey && this.callingSecretKey) {
      try {
        const response = await axios.post(`${this.obdBaseUrl}/call`, payload, {
          headers: this.getObdHeaders()
        });
        responseData = response.data;
      } catch (err) {
        console.error('[MyOperator OBD Call Error]:', err.response?.data || err.message);
        throw new Error(err.response?.data?.message || err.message || 'Failed to trigger outbound call');
      }
    } else {
      console.warn('[MyOperator OBD] API credentials missing. Using mock response for development.');
      responseData = { status: 'success', call_id: `MOCK_CALL_${Date.now()}` };
    }

    const providerCallId = String(responseData?.call_id || responseData?.id || `CALL_${Date.now()}`);

    // Lookup contact from customerPhone to link the call log
    const contact = await Contact.findOne({
      $or: [
        { phone: cleanCustomerPhone },
        { phone: `91${cleanCustomerPhone}` },
        { phone: `+91${cleanCustomerPhone}` }
      ]
    }).lean();

    // ── Save metadata only — NO audio binary ─────────────────────────────────
    const callLog = new CallLog({
      providerCallId,
      callId:        providerCallId,      // legacy alias
      direction:     'outbound',
      customerPhone: cleanCustomerPhone,
      agentPhone:    cleanAgentPhone,
      agentId:       agentId || null,
      contactId:     contact?._id || null,
      status:        'initiated',
      metadata:      responseData         // raw provider response for debugging
    });
    await callLog.save();

    return { success: true, providerCallId, callLog };
  }

  /**
   * Handle an inbound call webhook event from MyOperator.
   * Called from call.routes.js when MyOperator POSTs an inbound call event.
   * Saves metadata only — recording URL is fetched later when call ends.
   */
  async handleInboundCallWebhook(webhookPayload) {
    const {
      call_id, uuid, customer_number, agent_number,
      agent_id, status, duration, recording_url, recording_id,
      disposition
    } = webhookPayload;

    const providerCallId = String(call_id || uuid || `INBOUND_${Date.now()}`);
    const cleanPhone     = String(customer_number || '').replace(/\D/g, '').replace(/^91/, '');

    // Check if this call log already exists (for status updates)
    let callLog = await CallLog.findOne({
      $or: [{ providerCallId }, { callId: providerCallId }]
    });

    const contact = await Contact.findOne({
      $or: [
        { phone: cleanPhone },
        { phone: `91${cleanPhone}` },
        { phone: `+91${cleanPhone}` }
      ]
    }).lean();

    if (callLog) {
      // Update existing record with latest status/duration/recording
      if (status)        callLog.status          = this._normalizeStatus(status);
      if (duration)      callLog.durationSeconds = parseInt(duration, 10) || 0;
      if (recording_url) callLog.recordingUrl     = recording_url;   // URL only, no download
      if (recording_id)  callLog.recordingId      = recording_id;
      if (disposition)   callLog.disposition      = disposition;
      if (contact?._id)  callLog.contactId        = contact._id;
      callLog.metadata = { ...callLog.metadata, ...webhookPayload };
      await callLog.save();
    } else {
      // New inbound call record
      callLog = new CallLog({
        providerCallId,
        callId:         providerCallId,
        direction:      'inbound',
        customerPhone:  cleanPhone,
        agentPhone:     String(agent_number || '').replace(/\D/g, '').replace(/^91/, ''),
        agentId:        null,             // will be matched later via agent_number lookup
        contactId:      contact?._id || null,
        status:         this._normalizeStatus(status) || 'initiated',
        durationSeconds: parseInt(duration, 10) || 0,
        recordingUrl:   recording_url || null,   // URL only
        recordingId:    recording_id  || null,
        disposition:    disposition   || null,
        metadata:       webhookPayload
      });
      await callLog.save();
    }

    return callLog;
  }

  /**
   * Update call status from webhook (call answered, ended, missed, etc.)
   * Called when MyOperator sends a status-update event.
   */
  async updateCallStatus({ providerCallId, status, durationSeconds, recordingUrl, recordingId, disposition }) {
    const callLog = await CallLog.findOneAndUpdate(
      { $or: [{ providerCallId }, { callId: providerCallId }] },
      {
        ...(status         && { status: this._normalizeStatus(status) }),
        ...(durationSeconds !== undefined && { durationSeconds }),
        ...(recordingUrl   && { recordingUrl }),    // URL only — never binary
        ...(recordingId    && { recordingId }),
        ...(disposition    && { disposition })
      },
      { new: true }
    );
    return callLog;
  }

  /**
   * Fetch the recording URL from MyOperator API (called on-demand from the CRM).
   * Returns the URL — the audio file is served directly from MyOperator's CDN.
   * We do NOT download the file.
   */
  async getRecordingUrl(callId) {
    if (!this.callingToken || !callId) return null;

    try {
      const response = await axios.get(`${this.callingBaseUrl}/recording`, {
        params: {
          token:    this.callingToken,
          filename: callId
        }
      });
      return response.data?.url || response.data?.recording_url || response.data?.link || null;
    } catch (error) {
      console.error('[MyOperator Recording URL Error]:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Normalize provider status strings to our standard enum values.
   */
  _normalizeStatus(providerStatus) {
    if (!providerStatus) return null;
    const s = String(providerStatus).toLowerCase();
    if (s.includes('answer'))  return 'answered';
    if (s.includes('miss'))    return 'missed';
    if (s.includes('busy'))    return 'busy';
    if (s.includes('fail'))    return 'failed';
    if (s.includes('end') || s.includes('complet') || s.includes('hung')) return 'ended';
    if (s.includes('ring') || s.includes('dial'))  return 'ringing';
    if (s.includes('no_answer') || s.includes('no-answer')) return 'no-answer';
    return 'initiated';
  }
}

module.exports = new MyOperatorCallService();
