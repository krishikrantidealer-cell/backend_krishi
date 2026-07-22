const axios = require('axios');
const Contact = require('../models/Contact');
const User = require('../models/User');

class InteraktService {
  constructor() {
    this.apiKey = process.env.INTERAKT_API_KEY;
    this.baseUrl = 'https://api.interakt.ai/v1/public';
  }

  getHeaders() {
    return {
      'Authorization': `Basic ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Send WhatsApp Message (Template or Freeform text/media)
   */
  async sendMessage({ phone, countryCode = '91', type = 'Text', textBody = '', templateName = '', languageCode = 'en', bodyValues = [], mediaUrl = '', mediaType = 'Image' }) {
    if (!this.apiKey) {
      console.warn('[Interakt] API Key missing. Skipping dispatch.');
      return null;
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, ''); // Clean phone
      const fullPhone = `+${countryCode}${cleanPhone}`;

      // Base payload with recipient info
      const payload = {
        countryCode: `+${countryCode}`,
        phoneNumber: cleanPhone,
        callback_url: process.env.INTERAKT_CALLBACK_URL || undefined
      };

      if (type === 'Template') {
        payload.type = 'Template';
        payload.template = {
          name: templateName,
          languageCode,
          bodyValues
        };
        if (mediaUrl) {
          payload.template.headerValues = [mediaUrl];
        }
      } else {
        // Freeform Session Messages - The 'data' wrapper is strictly required by Interakt's Public API V1
        payload.type = 'Text';
        if (type === 'Image' || type === 'Document') {
          payload.type = type;
        }

        payload.data = {
          message: textBody || ''
        };

        if (mediaUrl) {
          payload.data.mediaUrl = mediaUrl;
          if (payload.type === 'Document') {
            try {
              const urlParts = mediaUrl.split('/');
              payload.data.fileName = urlParts[urlParts.length - 1].split('?')[0] || 'Document.pdf';
            } catch (e) {
              payload.data.fileName = 'Document.pdf';
            }
          }
        }
      }

      console.log(`[Interakt] Dispatching ${payload.type} to ${fullPhone}`);

      const response = await axios.post(`${this.baseUrl}/message/`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      const errorData = error.response?.data;
      console.error('[Interakt API Error]:', JSON.stringify(errorData || error.message));
      throw new Error(errorData?.message || errorData?.error?.message || error.message || 'Failed to dispatch WhatsApp message via Interakt');
    }
  }

  /**
   * User Track API - Add/Update user details, traits, and tags in Interakt
   */
  async trackUser({ phone, countryCode = '91', name = '', email = '', traits = {}, tags = [] }) {
    if (!this.apiKey) return null;
    try {
      const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
      const payload = {
        countryCode: `+${countryCode}`,
        phoneNumber: cleanPhone,
        name: name || undefined,
        email: email || undefined,
        traits: traits || {},
        tags: tags || []
      };

      console.log(`[Interakt] Tracking User for +${countryCode}${cleanPhone}`);
      const response = await axios.post(`${this.baseUrl}/track/users/`, payload, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('[Interakt User Track Error]:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Event Track API - Trigger automated campaign events in Interakt
   */
  async trackEvent({ phone, countryCode = '91', eventName, traits = {} }) {
    if (!this.apiKey || !eventName) return null;
    try {
      const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
      const payload = {
        countryCode: `+${countryCode}`,
        phoneNumber: cleanPhone,
        event: eventName,
        traits: traits || {}
      };

      console.log(`[Interakt] Tracking Event '${eventName}' for +${countryCode}${cleanPhone}`);
      const response = await axios.post(`${this.baseUrl}/track/events/`, payload, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('[Interakt Event Track Error]:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Round-Robin Assignment Logic (Database-Driven, Multi-instance Safe)
   */
  async assignNextSalesAgent() {
    const salesAgents = await User.find({ role: 'sales', isBlocked: false, isDeleted: false });
    if (salesAgents.length === 0) return null;

    // Find salesperson whose latest contact assignment is the oldest (longest idle agent)
    const agentAssignments = await Promise.all(salesAgents.map(async (agent) => {
      const latestContact = await Contact.findOne({ assignedTo: agent._id })
        .sort({ createdAt: -1 })
        .select('createdAt');
      return {
        agentId: agent._id,
        lastAssignedAt: latestContact ? latestContact.createdAt : new Date(0)
      };
    }));

    // Sort ascending by assignment timestamp (oldest/unassigned first)
    agentAssignments.sort((a, b) => a.lastAssignedAt - b.lastAssignedAt);
    return agentAssignments[0].agentId;
  }
}

module.exports = new InteraktService();
