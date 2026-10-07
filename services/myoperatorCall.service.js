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
// Enterprise Multi-Agent Telephony Registry
const AGENT_TELEPHONY_REGISTRY = {
  // Main Account (Yashraj Singh - Admin)
  '7316917246': {
    name: 'Yashraj Singh (Admin)',
    accountName: 'Main Account',
    did: '07316917246',
    companyId: '6ab0de5d51766538',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: 'd1160ee08c6afe8984492e716ef062fbaf912e6f86cf851a94122c6a2aaaec25',
    callingToken: '3b48e781de1440f4d5d8666f118204fb',
    extension: '11',
  },
  // Ram Ji Shukla - 2 (Anshika Gupta)
  '9399022067': {
    name: 'Anshika Gupta',
    accountName: 'Ram Ji Shukla - 2',
    did: '07316917267',
    companyId: '6abcea24dbd6a999',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: 'd8c9d2cb1c38f37082854758817405502e724f0c462253722f7d63142a4120cd',
    callingToken: 'e7789ae6f3a1472f9466913203f6f968',
    publicIvrId: '6ac391dc6b832209',
    userUuid: '6abe3b1d94d37977',
    extension: '11',
  },
  // Ram Ji Shukla - 3 (Runa Singh)
  '9201896604': {
    name: 'Runa Singh',
    accountName: 'Ram Ji Shukla - 3',
    did: '07316917220',
    companyId: '6abcea4e66e65852',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: '9cfb8784ad14c00ba9917e3d387d9fd5662e8da18c560eeee04d5a5b7153bd0b',
    callingToken: '94f9842c4ae8e739dbce7382dededf53',
    publicIvrId: '6ac3926ed5589198',
    userUuid: '6abe3cdaa65d9730',
    extension: '11',
  },
  // Ram Ji Shukla - 4 (Ajay Yadav)
  '9201896606': {
    name: 'Ajay Yadav',
    accountName: 'Ram Ji Shukla - 4',
    did: '07316917210',
    companyId: '6abcea68a9843790',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: '26cc2fcf309e2e3cb4fed04673df930661eeac9febb9c960df98e2c506497cc0',
    callingToken: '775acb38ba13d6833011994c74e356cd',
    publicIvrId: '6ac392e50b66c496',
    userUuid: '6abe3e4363d3e779',
    extension: '11',
  },
  // Ram Ji Shukla - 5 (Yogesh Nandwanshi / Ram Ji Shukla)
  '9399022063': {
    name: 'Yogesh Nandwanshi',
    accountName: 'Ram Ji Shukla - 5',
    did: '07316917208',
    companyId: '6abcea80a6fa9438',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: 'e4703ff3d78eda3f7016cedb5e8ef313eb2aa851149c164ff9791f85b2261da5',
    callingToken: '817c3545b32f7df16784c2416d467a9b',
    publicIvrId: '6abf9971d5b34126',
    userUuid: '6abe40026e466397',
    extension: '11',
  },
  // Ram Ji Shukla - 6 (Garima)
  '9201896603': {
    name: 'Garima',
    accountName: 'Ram Ji Shukla - 6',
    did: '07316917216',
    companyId: '6abceacb44b44323',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: 'fb3c759e39ad53a6b3e811e0f203fa5ca53db295225f9d33c140c0f5eab80760',
    callingToken: '55182190d578a476bc2b813ac804a294',
    publicIvrId: '6ac3932d1bae5749',
    userUuid: '6abe41494bcb1499',
    extension: '11',
  },
  // Ram Ji Shukla - 6 (Eram Istiyaque)
  '9201896608': {
    name: 'Eram Istiyaque',
    accountName: 'Ram Ji Shukla - 6',
    did: '07316917216',
    companyId: '6abceacb44b44323',
    callingXApiKey: 'oomfKA3I2K6TCJYistHyb7sDf0l0F6c8AZro5DJh',
    callingSecretKey: 'fb3c759e39ad53a6b3e811e0f203fa5ca53db295225f9d33c140c0f5eab80760',
    callingToken: '55182190d578a476bc2b813ac804a294',
    publicIvrId: '6ac3932d1bae5749',
    userUuid: '6abe41494bcb1499',
    extension: '11',
  }
};

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

    const effectiveAgentPhone = agentPhone || agentUser?.phoneNumber || '';
    const cleanAgentPhone = effectiveAgentPhone ? effectiveAgentPhone.replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '') : '';

    // Check pre-configured registry by phone or name
    const registryMatch = AGENT_TELEPHONY_REGISTRY[cleanAgentPhone] ||
      Object.values(AGENT_TELEPHONY_REGISTRY).find(r => 
        (agentUser?.firstName && r.name.toLowerCase().includes(agentUser.firstName.toLowerCase())) ||
        (agentUser?.lastName && r.name.toLowerCase().includes(agentUser.lastName.toLowerCase()))
      ) || {};

    const agentConfig = agentUser?.myoperatorConfig || {};
    const dedicatedDid = (agentConfig.did || registryMatch.did || '').replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
    const dedicatedVid = agentConfig.vid || registryMatch.extension || agentConfig.extension || '11';
    const agentUuid = agentConfig.uuid || agentConfig.userId || registryMatch.userUuid || '6abe40026e466397';

    const apiKey = agentConfig.callingXApiKey || agentConfig.apiKey || registryMatch.callingXApiKey || registryMatch.apiKey || this.callingXApiKey;
    const secretKey = agentConfig.callingSecretKey || agentConfig.secretKey || registryMatch.callingSecretKey || registryMatch.secretKey || this.callingSecretKey;
    const companyId = agentConfig.companyId || registryMatch.companyId || process.env.MYOPERATOR_COMPANY_ID || '6abcea80a6fa9438';
    const publicIvrId = agentConfig.publicIvrId || registryMatch.publicIvrId || process.env.MYOPERATOR_PUBLIC_IVR_ID || '6abf9971d5b34126';

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
    
    let token = this.callingToken || process.env.MYOPERATOR_CALLING_TOKEN;
    if (callLog?.agentPhone) {
      const cleanAgent = String(callLog.agentPhone).replace(/\D/g, '').replace(/^91/, '');
      const reg = AGENT_TELEPHONY_REGISTRY[cleanAgent];
      if (reg?.callingToken) {
        token = reg.callingToken;
      }
    }

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
  async hangupCall({ providerCallId, callId, referenceId, apiKey, secretKey, token, agentPhone, companyId }) {
    const key = apiKey || this.callingXApiKey;
    const secret = secretKey || this.callingSecretKey;
    const cid = providerCallId || callId || referenceId;

    let effectiveToken = token || this.callingToken;
    let effectiveCompanyId = companyId;
    if (agentPhone) {
      const cleanAgent = String(agentPhone).replace(/\D/g, '').replace(/^91/, '');
      const reg = AGENT_TELEPHONY_REGISTRY[cleanAgent];
      if (reg) {
        if (reg.callingToken) effectiveToken = reg.callingToken;
        if (reg.companyId) effectiveCompanyId = reg.companyId;
      }
    }

    if (!cid) return false;

    console.log(`[MyOperator] Sending Hangup/Disconnect command to telecom gateway for Call ID: ${cid} (Token: ${effectiveToken ? 'Provided' : 'Default'})`);

    const hangupEndpoints = [
      {
        url: `${this.callingBaseUrl}/call/hangup`,
        method: 'post',
        data: { token: effectiveToken, call_id: cid, id: cid, uid: cid }
      },
      {
        url: `${this.callingBaseUrl}/search/calls/hangup`,
        method: 'post',
        data: { token: effectiveToken, call_id: cid, id: cid }
      },
      {
        url: `${this.obdBaseUrl}/stop`,
        method: 'post',
        data: { secret_token: secret, call_id: cid, reference_id: referenceId || cid, ...(effectiveCompanyId && { company_id: effectiveCompanyId }) },
        headers: { 'x-api-key': key, 'secret-key': secret, 'Content-Type': 'application/json' }
      },
      {
        url: `${this.obdBaseUrl}/cancel`,
        method: 'post',
        data: { secret_token: secret, call_id: cid, reference_id: referenceId || cid, ...(effectiveCompanyId && { company_id: effectiveCompanyId }) },
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
   * Proactively pulls recent CDR logs from MyOperator search API across all accounts.
   * Ensures 100% data fidelity even if webhook deliveries are missed or delayed.
   */
  async syncRecentCallsFromMyOperator() {
    const User = require('../models/User');
    const wsService = require('./websocket.service');

    const accounts = [
      { name: 'Yashraj Singh (Admin)', email: 'admin@krishikranti.com', phone: '7316917246', token: '3b48e781de1440f4d5d8666f118204fb', companyId: '6ab0de5d51766538', did: '07316917246' },
      { name: 'Anshika Gupta', email: 'ebsale08@gmail.com', phone: '9399022067', token: 'e7789ae6f3a1472f9466913203f6f968', companyId: '6abcea24dbd6a999', did: '07316917267' },
      { name: 'Runa Singh', email: 'essentialsale14@gmail.com', phone: '9201896604', token: '94f9842c4ae8e739dbce7382dededf53', companyId: '6abcea4e66e65852', did: '07316917220' },
      { name: 'Ajay Yadav', email: 'essentialsale8@gmail.com', phone: '9201896606', token: '775acb38ba13d6833011994c74e356cd', companyId: '6abcea68a9843790', did: '07316917210' },
      { name: 'Yogesh Nandwanshi', email: 'sales3.essential@gmail.com', phone: '9399022063', token: '817c3545b32f7df16784c2416d467a9b', companyId: '6abcea80a6fa9438', did: '07316917208' },
      { name: 'Garima Gokulpure', email: 'essentialbiosciences12@gmail.com', phone: '9201896603', token: '55182190d578a476bc2b813ac804a294', companyId: '6abceacb44b44323', did: '07316917216' },
      { name: 'Eram Istiyaque', email: 'sales6.essential@gmail.com', phone: '9201896608', token: '55182190d578a476bc2b813ac804a294', companyId: '6abceacb44b44323', did: '07316917216' }
    ];

    const uniqueTokens = [...new Set(accounts.map(a => a.token).filter(Boolean))];
    let syncedCount = 0;

    for (const token of uniqueTokens) {
      const matchedAccounts = accounts.filter(a => a.token === token);
      const primaryAccount = matchedAccounts[0];

      const allRecords = [];

      // 1. Query POST https://developers.myoperator.co/search
      try {
        const res = await axios.post(`${this.callingBaseUrl}/search`, {
          token,
          limit: 100
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 8000
        });

        const hits = res.data?.data?.hits || res.data?.hits || [];
        if (Array.isArray(hits) && hits.length > 0) {
          for (const hit of hits) {
            allRecords.push(hit._source || hit);
          }
        } else {
          const rawData = res.data?.data || res.data?.records || res.data?.results || res.data;
          const records = Array.isArray(rawData?.records) ? rawData.records : (Array.isArray(rawData) ? rawData : []);
          if (records.length > 0) allRecords.push(...records);
        }
      } catch (err) {
        console.warn(`[MyOperator Sync] POST /search failed for token ${token.slice(0, 6)}...:`, err.message);
      }

      // Deduplicate records by unique id
      const uniqueRecordsMap = new Map();
      for (const r of allRecords) {
        const id = String(r.allcaller_id || r.uid || r.id || r.call_id || r.unique_id || r.reference_id || '');
        if (id && !uniqueRecordsMap.has(id)) {
          uniqueRecordsMap.set(id, r);
        }
      }

      for (const r of uniqueRecordsMap.values()) {
        const providerCallId = String(r.allcaller_id || r.uid || r.id || r.call_id || r.unique_id || r.reference_id || '');
        if (!providerCallId) continue;

        const typeLower = String(r.type || r.call_type || '').trim().toLowerCase();
        const dirLower = String(r.direction || '').trim().toLowerCase();
        const eventLower = String(r.event || '').trim().toLowerCase();

        const uniqueIdFromAddParams = Array.isArray(r.additional_parameters)
          ? r.additional_parameters.find(p => p.ky === 'unique_id')?.vl
          : null;

        const isMyOperatorOutboundSession = Boolean(
          (uniqueIdFromAddParams && String(uniqueIdFromAddParams).startsWith('i1.')) ||
          (r.unique_id && String(r.unique_id).startsWith('i1.')) ||
          (r.session_id && String(r.session_id).startsWith('i1.')) ||
          (r.call_id && String(r.call_id).startsWith('i1.')) ||
          (r.ref_id && String(r.ref_id).startsWith('i1.'))
        );

        const KNOWN_AGENT_PHONES = ['9201896606', '9399022063', '9201896603', '9201896608', '9201896604'];

        const isExplicitOutbound = isMyOperatorOutboundSession ||
                                   dirLower === 'outbound' ||
                                   dirLower === 'outgoing' ||
                                   dirLower === 'out' ||
                                   dirLower === '2' ||
                                   r.direction === 2 ||
                                   typeLower === 'outbound' ||
                                   typeLower === 'outgoing' ||
                                   typeLower === 'obd' ||
                                   typeLower === 'click2call' ||
                                   typeLower === 'c2c' ||
                                   typeLower === 'dialer' ||
                                   typeLower === '2' ||
                                   r.type === 2 ||
                                   eventLower.startsWith('outbound') ||
                                   eventLower.startsWith('outgoing') ||
                                   eventLower.includes('obd') ||
                                   eventLower.includes('c2c');

        const isExplicitInbound = !isExplicitOutbound && (
                                  dirLower === 'inbound' ||
                                  dirLower === 'incoming' ||
                                  dirLower === 'in' ||
                                  dirLower === '1' ||
                                  r.direction === 1 ||
                                  typeLower === 'inbound' ||
                                  typeLower === 'incoming' ||
                                  typeLower === 'ivr' ||
                                  typeLower === '1' ||
                                  r.type === 1 ||
                                  eventLower.startsWith('inbound') ||
                                  eventLower === 'incoming'
        );

        const isInbound = isExplicitInbound || (!isExplicitOutbound && !r.destination_number && !r.to);
        const direction = isInbound ? 'inbound' : 'outbound';

        let rawCustomerPhone = '';
        let rawAgentPhone = '';
        if (isInbound) {
          rawCustomerPhone = r.caller_number_raw || r.cli || r.caller_id || r.caller_number || r.customer_number || r.client_number || r.from || r.source || r.caller || r.number || r.phone || '';
          rawAgentPhone = r.log_details?.[0]?.received_by?.[0]?.contact_number_raw || r.log_details?.[0]?.transfer_to || r.log_details?.[0]?.agent_number || r.agent_number || r.user_number || r.receiver_number || r.agent_contact || r.transfer_to || r.legs?.[0]?.phone_number || r.agent?.contact || primaryAccount.phone;
        } else {
          rawCustomerPhone = r.customer_number || r.destination_number || r.client_number || r.number || r.phone || r.to || r.caller_number || '';
          rawAgentPhone = r.log_details?.[0]?.received_by?.[0]?.contact_number_raw || r.agent_number || r.user_number || r.caller || r.from || r.agent?.contact || primaryAccount.phone;
        }
        let customerPhone = String(rawCustomerPhone).replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
        let agentPhone = String(rawAgentPhone).replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');

        // Inversion check: if customerPhone is an agent, flip
        if (KNOWN_AGENT_PHONES.includes(customerPhone) && !agentPhone) {
          agentPhone = customerPhone;
          customerPhone = '';
        } else if (KNOWN_AGENT_PHONES.includes(customerPhone) && agentPhone && !KNOWN_AGENT_PHONES.includes(agentPhone)) {
          const temp = customerPhone;
          customerPhone = agentPhone;
          agentPhone = temp;
        }
        if (!customerPhone) continue;

        // Parse duration (e.g., "00:00:21" or number of seconds)
        let durationSeconds = 0;
        if (typeof r.duration === 'string' && r.duration.includes(':')) {
          const parts = r.duration.split(':').map(Number);
          if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1];
        } else {
          durationSeconds = parseInt(r.duration || r.talk_time || r.billsec || r.call_duration || 0, 10) || 0;
        }

        // Determine accurate status based on log_details and user status
        const logDetails = Array.isArray(r.log_details) ? r.log_details : [];
        const isReceived = logDetails.some(l => l.action === 'received' || l._ds === 'ANSWER') || (Array.isArray(r._us) && r._us.some(u => u.vl === 'received'));
        const isMissed = logDetails.some(l => l.action === 'missed' || l._ds === 'BUSY' || l._ds === 'CANCEL') || (Array.isArray(r._us) && r._us.some(u => u.vl === 'missed')) || String(r.state || '').toLowerCase().includes('miss');

        let status = 'initiated';
        if (isReceived) {
          status = 'answered';
        } else if (isMissed) {
          status = 'missed';
        } else if (durationSeconds > 0) {
          status = 'answered';
        } else {
          const rawStatus = (r.call_status || r.status || r.state || '').toLowerCase();
          status = this._normalizeStatus(rawStatus) || (rawStatus.includes('miss') ? 'missed' : 'ended');
        }
        
        let recordingUrl = r.fileurl || r.recording_url || r.recording || r.audio_url || r.file_url || r.download_url || r.url || r.recordings?.[0]?.url || r.recordings?.[0]?.filename || r.filename || null;
        if (recordingUrl && !recordingUrl.startsWith('http://') && !recordingUrl.startsWith('https://')) {
          recordingUrl = String(recordingUrl);
        }

        // Agent matching: check matched account by agent number, DID, user name tag, or primaryAccount
        let matchedAcc = null;
        const cleanAgentPhone = String(rawAgentPhone || '').replace(/\D/g, '').replace(/^91/, '').replace(/^0+/, '');
        if (cleanAgentPhone) {
          matchedAcc = accounts.find(a => a.phone === cleanAgentPhone || cleanAgentPhone.endsWith(a.phone) || a.phone.endsWith(cleanAgentPhone));
        }

        const agentNameFromUs = Array.isArray(r._us) && r._us[0]?.nm;
        if (!matchedAcc && agentNameFromUs) {
          matchedAcc = accounts.find(a => a.name.toLowerCase().includes(agentNameFromUs.toLowerCase()) || agentNameFromUs.toLowerCase().includes(a.name.toLowerCase()));
        }

        const rawRecordDid = String(r.received_on || r.did || r.virtual_number || '').replace(/\D/g, '').replace(/^0+/, '');
        if (!matchedAcc && rawRecordDid) {
          matchedAcc = accounts.find(a => {
            const cleanAccDid = a.did.replace(/\D/g, '').replace(/^0+/, '');
            return cleanAccDid === rawRecordDid || rawRecordDid.endsWith(cleanAccDid) || cleanAccDid.endsWith(rawRecordDid);
          });
        }
        if (!matchedAcc) {
          matchedAcc = primaryAccount;
        }

        let agentUser = await User.findOne({
          $or: [
            { email: matchedAcc.email.toLowerCase() },
            { phoneNumber: { $regex: matchedAcc.phone } }
          ]
        });
        const agentId = agentUser ? agentUser._id : null;
        const resolvedAgentPhone = agentUser?.phoneNumber || matchedAcc.phone || agentPhone;

        // Contact matching / creation
        let contact = await Contact.findOne({
          $or: [
            { phone: customerPhone },
            { phone: `91${customerPhone}` },
            { phone: `+91${customerPhone}` },
            { phone: `0${customerPhone}` }
          ]
        });

        if (!contact && customerPhone.length >= 10) {
          try {
            contact = await Contact.create({
              name: `Caller +91 ${customerPhone}`,
              phone: `+91${customerPhone}`,
              assignedTo: agentId
            });
          } catch (_) {
            contact = await Contact.findOne({
              $or: [{ phone: customerPhone }, { phone: `+91${customerPhone}` }]
            });
          }
        }

        let callTime = new Date();
        if (r.start_time) {
          const num = Number(r.start_time);
          if (!isNaN(num)) {
            callTime = new Date(num > 1e11 ? num : num * 1000);
          } else {
            callTime = new Date(r.start_time);
          }
        } else if (r.created_at || r.date_time) {
          callTime = new Date(r.created_at || r.date_time);
        }

        // Industrial Sync Cutoff: Ignore carrier CDRs older than configured watermark
        const syncCutoff = process.env.MYOPERATOR_SYNC_START_DATE ? new Date(process.env.MYOPERATOR_SYNC_START_DATE) : new Date('2026-10-07T00:00:00.000Z');
        if (callTime < syncCutoff) {
          continue;
        }

        const candidateIds = [
          providerCallId,
          uniqueIdFromAddParams,
          r.allcaller_id,
          r.uid,
          r.id,
          r.call_id,
          r.unique_id,
          r.reference_id,
          r.ref_id,
          r.session_id
        ].filter(Boolean).map(String);

        let existingLog = await CallLog.findOne({
          $or: [
            { providerCallId: { $in: candidateIds } },
            { callId: { $in: candidateIds } },
            { 'metadata.allcaller_id': { $in: candidateIds } },
            { 'metadata.unique_id': { $in: candidateIds } },
            { 'metadata.session_id': { $in: candidateIds } },
            { 'metadata.uid': { $in: candidateIds } },
            { 'metadata.id': { $in: candidateIds } },
            { 'metadata.additional_parameters.vl': { $in: candidateIds } },
            { 'metadata.additional_parameters': { $elemMatch: { ky: 'unique_id', vl: { $in: candidateIds } } } }
          ]
        });

        // Proximity deduplication: match by customer & agent phone within 180s window
        if (!existingLog && customerPhone) {
          const windowStart = new Date(callTime.getTime() - 180 * 1000);
          const windowEnd = new Date(callTime.getTime() + 180 * 1000);
          existingLog = await CallLog.findOne({
            customerPhone,
            createdAt: { $gte: windowStart, $lte: windowEnd }
          });
        }

        // Respect soft-deletion: If user previously deleted this call, do not un-delete
        if (existingLog && existingLog.isDeleted) {
          continue;
        }

        if (existingLog) {
          let changed = false;
          if (!existingLog.direction) {
            existingLog.direction = direction;
            changed = true;
          } else if (isExplicitOutbound && existingLog.direction !== 'outbound') {
            existingLog.direction = 'outbound';
            changed = true;
          } else if (existingLog.direction === 'outbound') {
            // NEVER downgrade an outbound call to inbound from CDR
          } else if (isExplicitInbound && existingLog.direction !== 'inbound' && existingLog.direction !== 'outbound') {
            existingLog.direction = 'inbound';
            changed = true;
          }
          if (status && existingLog.status !== status) {
            existingLog.status = status;
            changed = true;
          }
          if (durationSeconds > 0 && (!existingLog.durationSeconds || existingLog.durationSeconds === 0)) {
            existingLog.durationSeconds = durationSeconds;
            changed = true;
          }
          if (recordingUrl && (!existingLog.recordingUrl || existingLog.recordingUrl !== recordingUrl)) {
            existingLog.recordingUrl = recordingUrl;
            changed = true;
          }
          if (!existingLog.agentId && agentId) {
            existingLog.agentId = agentId;
            changed = true;
          }
          if (changed) {
            await existingLog.save();
            syncedCount++;

            const populated = await CallLog.findById(existingLog._id)
              .populate('agentId', 'firstName lastName email phoneNumber')
              .populate('contactId', 'name phone preferredLanguage');
            const broadcastPayload = {
              type: 'CALL_UPDATE',
              data: populated || existingLog.toObject()
            };
            if (agentId) wsService.sendToUser(agentId.toString(), broadcastPayload);
            wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
          }
        } else {
          const newLog = new CallLog({
            providerCallId,
            callId: providerCallId,
            direction,
            customerPhone,
            agentPhone: resolvedAgentPhone,
            agentId,
            contactId: contact?._id || null,
            status,
            durationSeconds,
            recordingUrl,
            callSummary: isInbound ? (status === 'missed' ? 'Missed Inbound Call' : 'Inbound Call') : 'Outbound Call',
            metadata: { ...r, syncedFromApi: true },
            createdAt: callTime
          });
          await newLog.save();
          syncedCount++;

          // Broadcast newly found call to panels immediately
          const populated = await CallLog.findById(newLog._id)
            .populate('agentId', 'firstName lastName email phoneNumber')
            .populate('contactId', 'name phone preferredLanguage');
          const broadcastPayload = {
            type: 'CALL_UPDATE',
            data: populated || newLog.toObject()
          };
          if (agentId) wsService.sendToUser(agentId.toString(), broadcastPayload);
          wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
        }
      }
    }

    return syncedCount;
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
