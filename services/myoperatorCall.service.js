const axios = require('axios');
const https = require('https');
const CallLog = require('../models/CallLog');
const Contact = require('../models/Contact');

// Persistent Keep-Alive Agent for Sub-50ms API Dispatches
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000
});

const apiClient = axios.create({
  httpsAgent: httpsKeepAliveAgent,
  timeout: 10000
});

/**
 * MyOperatorCallService
 *
 * Handles outbound OBD calls and recording URL lookups via MyOperator APIs.
 */
class MyOperatorCallService {
  constructor() {
    this.obdBaseUrl    = 'https://obd-api.myoperator.co/obd-api-v1';
    this.callingBaseUrl = 'https://developers.myoperator.co';
    this.callingXApiKey  = process.env.MYOPERATOR_CALLING_X_API_KEY || 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh';
    this.callingSecretKey = process.env.MYOPERATOR_CALLING_SECRET_KEY || 'd1160ee08c6afe8984492e716ef062fbaf912e6f86cf851a94122c6a2aaaec25';
    this.callingToken    = process.env.MYOPERATOR_CALLING_TOKEN || '3b48e781de1440f4d5d8666f118204fb';
  }

  getObdHeaders(customXApiKey, customSecretKey) {
    return {
      'x-api-key':    customXApiKey  || this.callingXApiKey  || '',
      'secret-key':   customSecretKey || this.callingSecretKey || '',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Trigger an Outbound OBD Call (connects sales agent → customer/dealer).
   * Supports dedicated per-agent DID, VID, and account credentials.
   */
  async triggerOutboundCall({ agentId, customerPhone, agentPhone, callMode = 'click2call' }) {
    const rawNumber = customerPhone.replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
    const cleanCustomerPhone = rawNumber;
    const countryCodeNumber = `+91${rawNumber}`;
    
    // Look up agent user to fetch dedicated DID, VID, and credentials
    let agentUser = null;
    if (agentId) {
      const User = require('../models/User');
      agentUser = await User.findById(agentId);
    }

    const agentConfig = agentUser?.myoperatorConfig || {};
    const dedicatedDid = (agentConfig.did || agentConfig.whatsappNumber || '').replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
    const dedicatedVid = agentConfig.vid || agentConfig.extension || '';
    const agentUuid = agentConfig.uuid || agentConfig.userId || '6abe40026e466397';
    const effectiveAgentPhone = agentPhone || agentUser?.phoneNumber || '';
    const cleanAgentPhone = effectiveAgentPhone ? effectiveAgentPhone.replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '') : '';

    const apiKey = agentConfig.callingXApiKey || agentConfig.apiKey || this.callingXApiKey;
    const secretKey = agentConfig.callingSecretKey || agentConfig.secretKey || this.callingSecretKey;
    const companyId = agentConfig.companyId || process.env.MYOPERATOR_COMPANY_ID || '6abcea80a6fa9438';
    const publicIvrId = agentConfig.publicIvrId || process.env.MYOPERATOR_PUBLIC_IVR_ID || '6abf9971d5b34126';

    let responseData = null;

    let webrtcSession = null;
    if (callMode === 'webcall') {
      try {
        webrtcSession = await this.generateWebRTCSession({
          agentId,
          agentExtension: dedicatedVid || '101',
          agentNumber: cleanAgentPhone
        });
      } catch (wsErr) {
        console.warn('[MyOperator WebRTC] Session generation warning:', wsErr.message);
      }
    }

    // ── Mode B: Fast Agent-First Mobile Click-to-Call (< 2-3s) ──────────
    const payload = {
      company_id:        companyId,
      secret_token:      secretKey,
      type:              '1',
      number:            countryCodeNumber,
      public_ivr_id:     publicIvrId,
      user_id:           agentUuid,
      ...(dedicatedDid && { caller_id: dedicatedDid }),
      max_call_duration: 600,
      call_hold:         false,
      reference_id:      `CRMCALL_${Date.now()}`
    };

    console.log(`[MyOperator OBD] Triggering Fast Click-to-Call for Agent (${agentUser?.firstName || 'Main'}) DID: ${dedicatedDid || 'Default'} -> Customer: ${countryCodeNumber}`);

    if (apiKey && secretKey) {
      try {
        const startTime = Date.now();
        const response = await apiClient.post(this.obdBaseUrl, payload, {
          headers: {
            'x-api-key': apiKey,
            'secret-key': secretKey,
            'Content-Type': 'application/json'
          }
        });
        responseData = response.data;
        console.log(`[MyOperator OBD] Fast dispatch completed in ${Date.now() - startTime}ms. Response:`, JSON.stringify(responseData));
        if (responseData?.status === 'error' || responseData?.status === 'failed' || (responseData?.code && parseInt(responseData.code, 10) >= 400)) {
          throw new Error(responseData.details || responseData.message || responseData.error || 'MyOperator outbound call limit reached');
        }
      } catch (err) {
        console.error('[MyOperator OBD Call Error]:', err.response?.data || err.message);
        throw new Error(err.response?.data?.details || err.response?.data?.message || err.message || 'Failed to trigger outbound call');
      }
    } else {
      console.warn('[MyOperator OBD] API credentials missing. Using mock response for development.');
      responseData = { status: 'success', unique_id: `MOCK_CALL_${Date.now()}` };
    }

    const providerCallId = String(responseData?.unique_id || responseData?.call_id || responseData?.id || responseData?.uuid || responseData?.reference_id || `CALL_${Date.now()}`);

    // Lookup contact from customerPhone to link the call log
    const contact = await Contact.findOne({
      $or: [
        { phone: cleanCustomerPhone },
        { phone: `91${cleanCustomerPhone}` },
        { phone: `+91${cleanCustomerPhone}` }
      ]
    }).lean();

    // ── Save metadata with dedicated Agent DID/VID ─────────────────────────
    const callLog = new CallLog({
      providerCallId,
      callId:        providerCallId,
      direction:     'outbound',
      customerPhone: cleanCustomerPhone,
      agentPhone:    cleanAgentPhone,
      agentId:       agentId || null,
      contactId:     contact?._id || null,
      status:        'initiated',
      metadata: {
        ...responseData,
        reference_id: payload.reference_id,
        callMode: callMode || 'click2call',
        webrtcSession,
        agentDid: dedicatedDid,
        agentVid: dedicatedVid
      }
    });
    await callLog.save();

    return { success: true, providerCallId, callMode: callMode || 'click2call', webrtcSession, callLog };
  }

  /**
   * Handle an inbound call webhook event from MyOperator.
   * Auto-resolves which sales agent owns the receiving DID / VID.
   */
  async handleInboundCallWebhook(webhookPayload) {
    const {
      call_id, uuid, customer_number, agent_number,
      did, vid, virtual_number, receiver_number, extension,
      status, duration, recording_url, recording_id,
      disposition
    } = webhookPayload;

    const providerCallId = String(call_id || uuid || `INBOUND_${Date.now()}`);
    const cleanPhone     = String(customer_number || '').replace(/\D/g, '').replace(/^91/, '');
    const incomingDid    = String(did || virtual_number || receiver_number || '').replace(/\D/g, '').replace(/^91/, '');
    const incomingVid    = String(vid || extension || '').trim();

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

    // Find which agent owns this dedicated DID or VID
    const User = require('../models/User');
    let matchedAgent = null;
    if (incomingDid || incomingVid) {
      matchedAgent = await User.findOne({
        role: 'sales',
        $or: [
          ...(incomingDid ? [{ 'myoperatorConfig.did': incomingDid }, { 'myoperatorConfig.did': `91${incomingDid}` }] : []),
          ...(incomingVid ? [{ 'myoperatorConfig.vid': incomingVid }, { 'myoperatorConfig.extension': incomingVid }] : [])
        ]
      }).select('_id firstName lastName phoneNumber');
    }

    if (!matchedAgent && contact?.assignedTo) {
      matchedAgent = await User.findById(contact.assignedTo).select('_id firstName lastName phoneNumber');
    }

    if (callLog) {
      if (status)        callLog.status          = this._normalizeStatus(status);
      if (duration)      callLog.durationSeconds = parseInt(duration, 10) || 0;
      if (recording_url) callLog.recordingUrl     = recording_url;
      if (recording_id)  callLog.recordingId      = recording_id;
      if (disposition)   callLog.disposition      = disposition;
      if (contact?._id)  callLog.contactId        = contact._id;
      if (matchedAgent?._id && !callLog.agentId) callLog.agentId = matchedAgent._id;
      callLog.metadata = { ...callLog.metadata, ...webhookPayload, matchedDid: incomingDid, matchedVid: incomingVid };
      await callLog.save();
    } else {
      callLog = new CallLog({
        providerCallId,
        callId:         providerCallId,
        direction:      'inbound',
        customerPhone:  cleanPhone,
        agentPhone:     matchedAgent?.phoneNumber || String(agent_number || '').replace(/\D/g, '').replace(/^91/, ''),
        agentId:        matchedAgent?._id || null,
        contactId:      contact?._id || null,
        status:         this._normalizeStatus(status) || 'initiated',
        durationSeconds: parseInt(duration, 10) || 0,
        recordingUrl:   recording_url || null,
        recordingId:    recording_id  || null,
        disposition:    disposition   || null,
        metadata:       { ...webhookPayload, matchedDid: incomingDid, matchedVid: incomingVid }
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
   * Fetch the direct playback link for a call recording from MyOperator.
   * Supports direct filename lookup, UID search, and CDR customer phone search.
   */
  async getRecordingUrl(target) {
    if (!target) return null;

    const callLog = (typeof target === 'object' && target !== null) ? target : null;
    const filenameOrCallId = (typeof target === 'string') ? target : (callLog?.providerCallId || callLog?.callId || '');
    const phone = (callLog?.customerPhone || '').toString().replace(/\D/g, '').replace(/^91/, '');
    const token = this.callingToken || process.env.MYOPERATOR_CALLING_TOKEN;

    if (!token) {
      console.warn('[MyOperator] MYOPERATOR_CALLING_TOKEN is not configured.');
      return null;
    }

    // 1. Direct file link if filename is present
    if (filenameOrCallId) {
      const cleanFile = filenameOrCallId.replace(/^CALL_/, '').replace(/^CRMCALL_/, '');
      for (const fileParam of [filenameOrCallId, cleanFile]) {
        try {
          const response = await axios.get(`${this.callingBaseUrl}/search/recordings/link`, {
            params: { token, file: fileParam },
            timeout: 3500
          });
          const link = response.data?.data?.url || response.data?.url || response.data?.link;
          if (link) return link;
        } catch (_) {}
      }
    }

    // 2. Query MyOperator search by call ID or UID
    if (filenameOrCallId) {
      try {
        const uidRes = await axios.get(`${this.callingBaseUrl}/search/recordings`, {
          params: { token, uid: filenameOrCallId, call_id: filenameOrCallId },
          timeout: 4000
        });
        const rec = uidRes.data?.data?.url || uidRes.data?.url || uidRes.data?.data?.[0]?.url || uidRes.data?.records?.[0]?.recording_url;
        if (rec) return rec;
      } catch (_) {}
    }

    // 3. Fallback: Search MyOperator CDR records by customer phone number
    if (phone) {
      const searchEndpoints = [
        `${this.callingBaseUrl}/search`,
        `${this.callingBaseUrl}/search/cdr`,
        `${this.callingBaseUrl}/search/calls`
      ];

      for (const ep of searchEndpoints) {
        try {
          const searchRes = await axios.get(ep, {
            params: { token, number: phone },
            timeout: 4500
          });

          const data = searchRes.data?.data || searchRes.data?.records || searchRes.data;
          const records = Array.isArray(data?.records) ? data.records : (Array.isArray(data) ? data : []);
          
          if (records.length > 0) {
            for (const r of records) {
              const url = r.recording_url || r.recording || r.audio_url || r.file_url || r.filename;
              if (url) {
                console.log(`[MyOperator] Found recording URL via CDR search for phone ${phone}: ${url}`);
                return url;
              }
            }
          }
        } catch (_) {}
      }
    }

    return null;
  }

  /**
   * Generate or retrieve WebRTC SIP credentials / session details for In-Browser Web Calling
   */
  async generateWebRTCSession({ agentId, agentExtension, agentNumber }) {
    try {
      return {
        enabled: true,
        webrtcGateway: 'wss://webrtc.myoperator.co/ws',
        extension: agentExtension || '101',
        agentNumber: agentNumber || '',
        agentId: agentId || '',
        companyId: process.env.MYOPERATOR_COMPANY_ID || '6ab0de5d51766538',
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('[MyOperator WebRTC Session Error]:', error.message);
      throw new Error('Failed to generate WebRTC calling session');
    }
  }

  /**
   * Sync agent call-receive availability status with MyOperator
   */
  async setAgentCallAvailability({ token, agentId, receiveCalls = 1 }) {
    if (!this.callingToken) return false;
    try {
      const response = await axios.put(`${this.callingBaseUrl}/search/user`, null, {
        params: {
          token: this.callingToken,
          id: agentId,
          receive_calls: receiveCalls ? 1 : 0
        }
      });
      return response.data?.status === 'success' || response.status === 200;
    } catch (error) {
      console.error('[MyOperator Set Agent Status Error]:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Instruct MyOperator telecom switch to disconnect / hang up an active PSTN/OBD call leg.
   */
  async hangupCall({ providerCallId, callId, referenceId, apiKey, secretKey }) {
    const key = apiKey || this.callingXApiKey;
    const secret = secretKey || this.callingSecretKey;
    const cid = providerCallId || callId || referenceId;

    if (!cid) return false;

    console.log(`[MyOperator] Sending Hangup/Disconnect command to telecom gateway for Call ID: ${cid}`);

    const hangupEndpoints = [
      {
        url: `${this.callingBaseUrl}/call/hangup`,
        method: 'post',
        data: { token: this.callingToken, call_id: cid, id: cid }
      },
      {
        url: `${this.obdBaseUrl}/stop`,
        method: 'post',
        data: { secret_token: secret, call_id: cid, reference_id: referenceId || cid },
        headers: { 'x-api-key': key, 'secret-key': secret, 'Content-Type': 'application/json' }
      },
      {
        url: `${this.obdBaseUrl}/cancel`,
        method: 'post',
        data: { secret_token: secret, call_id: cid, reference_id: referenceId || cid },
        headers: { 'x-api-key': key, 'secret-key': secret, 'Content-Type': 'application/json' }
      }
    ];

    for (const ep of hangupEndpoints) {
      try {
        const res = await axios({
          url: ep.url,
          method: ep.method,
          data: ep.data,
          headers: ep.headers || { 'Content-Type': 'application/json' },
          timeout: 2500
        });
        if (res.status === 200 || res.data?.status === 'success') {
          console.log(`[MyOperator] Hangup command successfully processed by ${ep.url}`);
          return true;
        }
      } catch (_) {
        // Fall through to try other gateway endpoints
      }
    }

    return false;
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
