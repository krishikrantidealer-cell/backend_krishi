const axios = require('axios');
const Contact = require('../models/Contact');
const User = require('../models/User');

class MyOperatorService {
  constructor() {
    this.wabaKey = process.env.MYOPERATOR_WABA_KEY;
    this.baseUrl = 'https://publicapi.myoperator.co';
  }

  getHeaders() {
    return {
      'x-api-key': this.wabaKey,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Send WhatsApp Message via MyOperator WABA Public API
   */
  async sendMessage({ phone, countryCode = '91', type = 'Text', textBody = '', templateName = '', languageCode = 'en', bodyValues = [], mediaUrl = '', mediaType = 'Image' }) {
    if (!this.wabaKey) {
      console.warn('[MyOperator WABA] API Key missing. Check MYOPERATOR_WABA_KEY env var.');
      return null;
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '').replace(/^91/, '');
      const fullPhone = `+${countryCode}${cleanPhone}`;

      let payload = {
        recipient: {
          country_code: `+${countryCode}`,
          phone_number: cleanPhone
        }
      };

      if (type === 'Template' || templateName) {
        payload.type = 'template';
        payload.template = {
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
        };

        if (mediaUrl) {
          payload.template.components.unshift({
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
        payload.type = 'text';
        payload.text = {
          body: textBody || ''
        };

        if (mediaUrl) {
          const typeKey = mediaType.toLowerCase() === 'document' ? 'document' : 'image';
          payload.type = typeKey;
          payload[typeKey] = {
            link: mediaUrl,
            caption: textBody || ''
          };
        }
      }

      console.log(`[MyOperator WABA] Dispatching ${payload.type} to ${fullPhone}`);

      const response = await axios.post(`${this.baseUrl}/messages`, payload, {
        headers: this.getHeaders()
      });

      return response.data;
    } catch (error) {
      const errorData = error.response?.data;
      console.error('[MyOperator WABA API Error]:', JSON.stringify(errorData || error.message));
      throw new Error(errorData?.message || errorData?.error?.message || error.message || 'Failed to dispatch WhatsApp message via MyOperator');
    }
  }

  /**
   * List approved WhatsApp templates from MyOperator
   */
  async getTemplates() {
    if (!this.wabaKey) return [];
    try {
      const response = await axios.get(`${this.baseUrl}/templates`, {
        headers: this.getHeaders()
      });
      return response.data?.data || response.data || [];
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
