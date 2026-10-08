const axios = require('axios');
const Contact = require('../models/Contact');
const User = require('../models/User');

class MyOperatorService {
  constructor() {
    this.wabaKey = process.env.MYOPERATOR_WABA_KEY;
    this.companyId = process.env.MYOPERATOR_COMPANY_ID || '6ab0de5d51766538';
    this.phoneNumberId = process.env.MYOPERATOR_PHONE_NUMBER_ID || '';
    this.baseUrl = 'https://publicapi.myoperator.co';
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (this.wabaKey) {
      headers['Authorization'] = `Bearer ${this.wabaKey}`;
    }
    if (this.companyId) {
      headers['X-MYOP-COMPANY-ID'] = this.companyId;
    }
    return headers;
  }

  /**
   * Helper to ensure phone_number_id is available
   */
  async getPhoneNumberId() {
    if (this.phoneNumberId) return this.phoneNumberId;
    try {
      const response = await axios.get(`${this.baseUrl}/chat/phonenumbers`, {
        headers: this.getHeaders()
      });
      const numbers = response.data?.data?.results || response.data?.data || [];
      if (numbers.length > 0 && numbers[0].id) {
        this.phoneNumberId = numbers[0].id;
        return this.phoneNumberId;
      }
    } catch (err) {
      console.warn('[MyOperator] Could not auto-fetch phone_number_id:', err.message);
    }
    return '';
  }

  /**
   * Send WhatsApp Message via MyOperator WABA Public API (/chat/messages)
   */
  async sendMessage({ agentId, phone, countryCode = '91', type = 'Text', textBody = '', templateName = '', languageCode = 'en', bodyValues = [], mediaUrl = '', mediaType = 'Image' }) {
    if (!this.wabaKey) {
      console.warn('[MyOperator WABA] API Key missing. Check MYOPERATOR_WABA_KEY env var.');
      return null;
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
      
      // Check if the agent has a dedicated WhatsApp phone number or custom sub-account
      let agentUser = null;
      if (agentId) {
        agentUser = await User.findById(agentId);
      }
      const agentConfig = agentUser?.myoperatorConfig || {};
      const customPhoneNumId = agentConfig.wabaPhoneNumberId || (await this.getPhoneNumberId()) || this.phoneNumberId || '1307352865799863';

      let payload = {
        phone_number_id: customPhoneNumId,
        customer_country_code: countryCode,
        customer_number: cleanPhone,
        data: {}
      };

      if (type === 'Template' || templateName) {
        const validBodyParams = Array.isArray(bodyValues)
          ? bodyValues.filter(v => v !== null && v !== undefined).map(v => String(v).trim())
          : [];

        const contextObj = {
          template_name: templateName,
          language: languageCode || 'en'
        };

        if (validBodyParams.length > 0) {
          contextObj.body_values = validBodyParams;
          contextObj.parameters = validBodyParams;
        }

        if (mediaUrl) {
          contextObj.media_url = mediaUrl;
          contextObj.media_type = (mediaType || 'Image').toLowerCase();
        }

        payload.data = {
          type: 'template',
          context: contextObj
        };
      } else {
        // Freeform Session Message
        payload.data = {
          type: 'text',
          context: {
            body: textBody || '',
            preview_url: false
          }
        };

        if (mediaUrl) {
          const typeKey = mediaType.toLowerCase() === 'document' ? 'document' : 'image';
          payload.data.type = typeKey;
          payload.data[typeKey] = {
            link: mediaUrl,
            caption: textBody || ''
          };
        }
      }

      console.log(`[MyOperator WABA] Dispatching to +${countryCode}${cleanPhone} from Agent (${agentUser?.firstName || 'Main'} PhoneId: ${customPhoneNumId}):`, JSON.stringify(payload));

      const headers = this.getHeaders();
      const customWabaKey = agentConfig.wabaKey || agentConfig.apiKey;
      if (customWabaKey && typeof customWabaKey === 'string' && customWabaKey.trim() !== '') {
        headers['Authorization'] = `Bearer ${customWabaKey.trim()}`;
      }
      if (agentConfig.companyId && typeof agentConfig.companyId === 'string' && agentConfig.companyId.trim() !== '') {
        headers['X-MYOP-COMPANY-ID'] = agentConfig.companyId.trim();
      }

      const response = await axios.post(`${this.baseUrl}/chat/messages`, payload, { headers });

      return response.data;
    } catch (error) {
      const errorData = error.response?.data;
      console.error('[MyOperator WABA API Error]:', JSON.stringify(errorData || error.message));
      throw new Error(errorData?.message || errorData?.error?.message || (errorData?.errors ? JSON.stringify(errorData.errors) : error.message) || 'Failed to dispatch WhatsApp message via MyOperator');
    }
  }

  /**
   * List approved WhatsApp templates from MyOperator
   */
  async getTemplates() {
    if (!this.wabaKey) return [];
    try {
      const response = await axios.get(`${this.baseUrl}/chat/templates?limit=100&offset=0`, {
        headers: this.getHeaders()
      });
      return response.data?.data?.results || response.data?.data || response.data || [];
    } catch (error) {
      console.error('[MyOperator WABA Templates Error]:', error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Upload Media (Image/Video/PDF Document) to MyOperator to obtain media_id
   */
  async uploadMedia({ fileBuffer, fileName, mimeType }) {
    if (!this.wabaKey) {
      throw new Error('MYOPERATOR_WABA_KEY is required to upload media.');
    }

    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });

      const headers = {
        ...this.getHeaders(),
        ...form.getHeaders()
      };

      const response = await axios.post(`${this.baseUrl}/chat/media/upload`, form, { headers });
      return response.data?.data || response.data;
    } catch (error) {
      console.error('[MyOperator WABA Media Upload Error]:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to upload media to MyOperator');
    }
  }

  /**
   * Create a new WhatsApp Template at Meta via MyOperator API
   */
  async createTemplate(templatePayload) {
    if (!this.wabaKey) {
      throw new Error('MYOPERATOR_WABA_KEY is required to create templates.');
    }

    try {
      const response = await axios.post(`${this.baseUrl}/chat/templates`, templatePayload, {
        headers: this.getHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('[MyOperator Create Template Error]:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || error.message || 'Failed to create template');
    }
  }

  /**
   * Delete a WhatsApp Template from MyOperator
   */
  async deleteTemplate(templateId) {
    if (!this.wabaKey || !templateId) return false;

    try {
      const response = await axios.delete(`${this.baseUrl}/chat/templates/${templateId}`, {
        headers: this.getHeaders()
      });
      return response.data?.status === 'success' || response.status === 200;
    } catch (error) {
      console.error('[MyOperator Delete Template Error]:', error.response?.data || error.message);
      return false;
    }
  }

  /**
   * Auto-assign next sales agent using round-robin logic
   */
  async assignNextSalesAgent() {
    try {
      const salesAgents = await User.find({ role: 'sales', isActive: true }).select('_id');
      if (!salesAgents || salesAgents.length === 0) return null;

      const lastAssignedContact = await Contact.findOne({ assignedTo: { $exists: true } })
        .sort({ updatedAt: -1 })
        .select('assignedTo');

      if (!lastAssignedContact || !lastAssignedContact.assignedTo) {
        return salesAgents[0]._id;
      }

      const lastIndex = salesAgents.findIndex(a => String(a._id) === String(lastAssignedContact.assignedTo));
      const nextIndex = (lastIndex + 1) % salesAgents.length;
      return salesAgents[nextIndex]._id;
    } catch (error) {
      console.error('[MyOperator Assign Agent Error]:', error.message);
      return null;
    }
  }
}

module.exports = new MyOperatorService();
