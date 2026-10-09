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
      
      // Check agent identity
      let agentUser = null;
      if (agentId) {
        agentUser = await User.findById(agentId);
      }
      
      // Always use verified master WABA phone number ID for WhatsApp messaging
      const targetPhoneNumId = (await this.getPhoneNumberId()) || this.phoneNumberId || '1307352865799863';

      let payload = {
        phone_number_id: targetPhoneNumId,
        customer_country_code: countryCode,
        customer_number: cleanPhone,
        data: {}
      };

      const isTemplate = type?.toLowerCase() === 'template' || Boolean(templateName);

      if (isTemplate) {
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
      } else if (mediaUrl && mediaUrl.toString().trim().length > 0) {
        // Freeform Media Message (Image, Document, Audio, Video)
        const rawType = (mediaType || type || 'image').toLowerCase();
        let resolvedType = 'image';
        if (rawType.includes('doc') || rawType.includes('pdf') || rawType.includes('xls') || rawType.includes('csv')) {
          resolvedType = 'document';
        } else if (rawType.includes('video') || rawType.includes('mp4')) {
          resolvedType = 'video';
        } else if (rawType.includes('audio') || rawType.includes('voice') || rawType.includes('mp3') || rawType.includes('ogg')) {
          resolvedType = 'audio';
        } else {
          resolvedType = 'image';
        }

        const mediaObj = {
          link: mediaUrl.toString().trim()
        };

        if (textBody && textBody.trim().length > 0 && resolvedType !== 'audio') {
          mediaObj.caption = textBody.trim();
        }

        if (resolvedType === 'document') {
          try {
            const urlPath = new URL(mediaUrl).pathname;
            const filename = urlPath.split('/').pop();
            if (filename && filename.includes('.')) {
              mediaObj.filename = decodeURIComponent(filename);
            }
          } catch (_) {}
        }

        payload.data = {
          type: resolvedType,
          [resolvedType]: mediaObj
        };
      } else {
        // Freeform Plain Text Message
        payload.data = {
          type: 'text',
          context: {
            body: textBody || '',
            preview_url: false
          }
        };
      }

      console.log(`[MyOperator WABA] Dispatching to +${countryCode}${cleanPhone} on behalf of Agent (${agentUser?.firstName || 'System'} PhoneId: ${targetPhoneNumId}):`, JSON.stringify(payload));

      const headers = this.getHeaders();
      const response = await axios.post(`${this.baseUrl}/chat/messages`, payload, { headers });

      return response.data;
    } catch (error) {
      const errorData = error.response?.data;
      console.error('[MyOperator WABA API Error]:', JSON.stringify(errorData || error.message));
      throw new Error(errorData?.message || errorData?.error?.message || (errorData?.errors ? JSON.stringify(errorData.errors) : error.message) || 'Failed to dispatch WhatsApp message via MyOperator');
    }
  }

  /**
   * Mark incoming WhatsApp Message as Read in Meta / MyOperator WABA
   * Triggers the blue double checkmarks on customer's phone
   */
  async markMessageAsRead(messageId) {
    if (!messageId) return false;

    const metaToken = process.env.META_WHATSAPP_TOKEN || process.env.WHATSAPP_CLOUD_API_TOKEN;
    const targetPhoneNumId = (await this.getPhoneNumberId()) || this.phoneNumberId || '1307352865799863';

    // 1. If Meta Cloud API token is configured, send directly to Meta Graph API
    if (metaToken) {
      try {
        const response = await axios.post(
          `https://graph.facebook.com/v21.0/${targetPhoneNumId}/messages`,
          {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId.toString()
          },
          {
            headers: {
              'Authorization': `Bearer ${metaToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`[Meta WABA] 👁️ Sent direct blue tick read receipt for message ${messageId}:`, response.data);
        return true;
      } catch (metaErr) {
        console.warn(`[Meta WABA Read Receipt Error for ${messageId}]:`, metaErr.response?.data || metaErr.message);
      }
    }

    return false;
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

  /**
   * Direct 2-Way Sync for all Conversations & Messages from MyOperator API
   */
  async syncAllMessagesFromMyOperator() {
    if (!this.wabaKey) return { synced: 0 };
    if (this._isSyncing) {
      return { synced: 0, status: 'in_progress' };
    }
    this._isSyncing = true;
    try {
      const Conversation = require('../models/Conversation');
      const Message = require('../models/Message');
      const wsService = require('./websocket.service');

      const res = await axios.get(`${this.baseUrl}/chat/conversations`, { headers: this.getHeaders() });
      const convs = res.data?.data?.results || [];
      if (!Array.isArray(convs) || convs.length === 0) {
        this._isSyncing = false;
        return { synced: 0 };
      }

      let importedCount = 0;

      for (const c of convs) {
        const rawPhone = c.customer_contact;
        if (!rawPhone) continue;
        const cleanPhone = rawPhone.replace(/\D/g, '').replace(/^91/, '');
        const customerName = c.customer_name || (`Customer ${cleanPhone.slice(-4)}`);

        let contact = await Contact.findOne({
          $or: [
            { phone: cleanPhone },
            { phone: `91${cleanPhone}` },
            { phone: `+91${cleanPhone}` }
          ]
        });

        if (!contact) {
          const defaultAgent = await this.assignNextSalesAgent();
          contact = new Contact({
            name: customerName,
            phone: cleanPhone,
            assignedTo: defaultAgent,
            tags: ['myoperator-lead']
          });
          await contact.save();
        }

        let conversation = await Conversation.findOne({ contactId: contact._id });
        if (!conversation) {
          conversation = new Conversation({
            contactId: contact._id,
            assignedTo: contact.assignedTo,
            status: 'open'
          });
          await conversation.save();
        }

        try {
          const msgRes = await axios.get(`${this.baseUrl}/chat/conversations/${c.id}/messages`, { headers: this.getHeaders() });
          const myopMsgs = msgRes.data?.data?.results || [];

          for (const m of myopMsgs) {
            const myopMsgId = m.id || m.metadata?.waba_msg_id;
            const direction = m.action === 'incoming' ? 'incoming' : 'outgoing';

            let content = '';
            if (m.data?.context?.body?.context) {
              content = m.data.context.body.context;
            } else if (m.data?.context?.body) {
              content = typeof m.data.context.body === 'string' ? m.data.context.body : (m.data.context.body.context || JSON.stringify(m.data.context.body));
            } else if (m.data?.context?.text) {
              content = m.data.context.text;
            } else if (m.data?.body) {
              content = m.data.body;
            } else if (m.data?.text) {
              content = m.data.text;
            }

            let replyToObj = null;
            if (m.is_reply || m.reply_to || m.data?.context?.id) {
              const replyId = m.reply_to || m.data?.context?.id;
              let refMsg = replyId ? await Message.findOne({
                $or: [
                  { myoperatorMessageId: replyId.toString() }
                ]
              }).lean() : null;

              if (!refMsg && Array.isArray(myopMsgs)) {
                const foundInBatch = myopMsgs.find(bm => bm.id === replyId || bm.metadata?.waba_msg_id === replyId);
                if (foundInBatch) {
                  let refContent = foundInBatch.data?.context?.body?.context || foundInBatch.data?.context?.body || foundInBatch.data?.body || foundInBatch.data?.text || '';
                  if (typeof refContent !== 'string') refContent = JSON.stringify(refContent);
                  replyToObj = {
                    messageId: replyId,
                    senderName: foundInBatch.action === 'incoming' ? customerName : 'You',
                    content: refContent
                  };
                }
              } else if (refMsg) {
                replyToObj = {
                  messageId: replyId,
                  senderName: refMsg.direction === 'incoming' ? customerName : 'You',
                  content: refMsg.content
                };
              }
            }

            const orConds = [];
            if (myopMsgId) orConds.push({ myoperatorMessageId: myopMsgId.toString() });
            if (content) orConds.push({ conversationId: conversation._id, content: content, direction: direction });

            const existing = orConds.length > 0 ? await Message.findOne({ $or: orConds }) : null;

            if (!existing && content) {
              const msgType = m.data?.type === 'template' ? 'template' : (m.data?.type || 'text');
              const newMsg = new Message({
                conversationId: conversation._id,
                contactId: contact._id,
                direction: direction,
                type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
                content: content,
                replyTo: replyToObj,
                myoperatorMessageId: myopMsgId ? myopMsgId.toString() : undefined,
                status: m.status === 'read' ? 'read' : (m.status === 'delivered' ? 'delivered' : (direction === 'incoming' ? 'delivered' : 'sent')),
                createdAt: m.created ? new Date(m.created) : new Date()
              });
              await newMsg.save();
              importedCount++;

              conversation.lastMessage = {
                type: newMsg.type,
                content: newMsg.content
              };
              conversation.lastMessageAt = newMsg.createdAt;
              if (direction === 'incoming') {
                conversation.unreadCount = (conversation.unreadCount || 0) + 1;
                conversation.lastIncomingMessageAt = newMsg.createdAt;
              }

              // Broadcast real-time message to panel
              const populatedMessage = await Message.findById(newMsg._id).populate('sentBy', 'firstName lastName');
              const populatedConversation = await Conversation.findById(conversation._id).populate(['contactId', 'assignedTo']);

              const broadcastPayload = {
                type: 'NEW_MESSAGE',
                data: {
                  conversation: populatedConversation,
                  message: populatedMessage
                }
              };
              if (contact.assignedTo) {
                wsService.sendToUser(contact.assignedTo.toString(), broadcastPayload);
              }
              wsService.broadcastToRoles(['admin', 'sales'], broadcastPayload);
            }
          }
          await conversation.save();
        } catch (msgErr) {
          console.warn(`[MyOperator Sync] Failed to fetch messages for conv ${c.id}:`, msgErr.message);
        }
      }
      return { synced: importedCount, totalConversations: convs.length };
    } catch (err) {
      console.error('[MyOperator Sync Conversations Error]:', err.message);
      return { synced: 0, error: err.message };
    } finally {
      this._isSyncing = false;
    }
  }
}

module.exports = new MyOperatorService();
