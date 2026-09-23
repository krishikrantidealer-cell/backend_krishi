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
  async sendMessage({ phone, countryCode = '91', type = 'Text', textBody = '', templateName = '', languageCode = 'en', bodyValues = [], mediaUrl = '', mediaType = 'Image' }) {
    if (!this.wabaKey) {
      console.warn('[MyOperator WABA] API Key missing. Check MYOPERATOR_WABA_KEY env var.');
      return null;
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
      const phoneNumId = await this.getPhoneNumberId();

      let payload = {
        phone_number_id: phoneNumId || undefined,
        customer_country_code: countryCode,
        customer_number: cleanPhone,
        data: {}
      };

      if (type === 'Template' || templateName) {
        payload.data = {
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode
            },
            components: [
              {
                type: 'body',
                parameters: bodyValues.map(val => ({
                  type: 'text',
                  text: String(val)
                }))
              }
            ]
          }
        };

        if (mediaUrl) {
          payload.data.template.components.unshift({
            type: 'header',
            parameters: [
              {
                type: mediaType.toLowerCase() === 'document' ? 'document' : 'image',
                [mediaType.toLowerCase() === 'document' ? 'document' : 'image']: {
                  link: mediaUrl
                }
              }
            ]
          });
        }
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

      console.log(`[MyOperator WABA] Dispatching to +${countryCode}${cleanPhone}:`, JSON.stringify(payload));

      const response = await axios.post(`${this.baseUrl}/chat/messages`, payload, {
        headers: this.getHeaders()
      });

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
      const response = await axios.get(`${this.baseUrl}/chat/templates`, {
        headers: this.getHeaders()
      });
      return response.data?.data?.results || response.data?.data || response.data || [];
    } catch (error) {
      console.error('[MyOperator WABA Templates Error]:', error.response?.data || error.message);
      return [];
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
