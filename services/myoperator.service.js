const axios = require('axios');
const Contact = require('../models/Contact');
const User = require('../models/User');
const wsService = require('./websocket.service');
const { normalizeIndianPhone, getPhoneQueryVariants } = require('../utils/phone');

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
      headers['x-api-key'] = this.wabaKey;
    }
    if (this.companyId) {
      headers['X-MYOP-COMPANY-ID'] = this.companyId;
      headers['x-myop-company-id'] = this.companyId;
    }
    return headers;
  }

  /**
   * Helper to ensure phone_number_id is available
   */
  async getPhoneNumberId() {
    return process.env.MYOPERATOR_PHONE_NUMBER_ID || this.phoneNumberId || '1307352865799863';
  }

  /**
   * Send WhatsApp Message via MyOperator WABA Public API (/chat/messages)
   */
  async sendMessage({ agentId, phone, countryCode = '91', type = 'Text', textBody = '', templateName = '', languageCode = 'en', bodyValues = [], mediaUrl = '', mediaType = 'Image', contextMessageId = '', replyToMessageId = '' }) {
    if (!this.wabaKey) {
      console.warn('[MyOperator WABA] API Key missing. Check MYOPERATOR_WABA_KEY env var.');
      return null;
    }

    try {
      const cleanPhone = normalizeIndianPhone(phone);
      
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

        console.log(`[MyOperator WABA] Dispatching Template (${templateName}) to +${countryCode}${cleanPhone}:`, JSON.stringify(payload));
        const headers = this.getHeaders();
        const response = await axios.post(`${this.baseUrl}/chat/messages`, payload, { headers });
        return response.data;
      } else if (mediaUrl && mediaUrl.toString().trim().length > 0) {
        // Freeform Media Message (Image, Document, Audio, Video)
        const cleanMediaUrl = mediaUrl.toString().trim();
        const headers = this.getHeaders();
        const rawType = (mediaType || type || 'image').toLowerCase();
        let resolvedType = 'image';
        if (rawType.includes('doc') || rawType.includes('pdf') || rawType.includes('xls') || rawType.includes('csv') || rawType.includes('sheet') || rawType.includes('word') || rawType.includes('file')) {
          resolvedType = 'document';
        } else if (rawType.includes('video') || rawType.includes('mp4')) {
          resolvedType = 'video';
        } else if (rawType.includes('audio') || rawType.includes('voice') || rawType.includes('mp3') || rawType.includes('ogg')) {
          resolvedType = 'audio';
        } else {
          resolvedType = 'image';
        }

        // Extract filename from mediaUrl or generate default
        let resolvedFilename = 'document.pdf';
        try {
          const urlObj = new URL(mediaUrl);
          const extracted = urlObj.pathname.split('/').pop();
          if (extracted && extracted.trim().length > 0) {
            resolvedFilename = decodeURIComponent(extracted.split('?')[0]);
          }
        } catch (_) {
          resolvedFilename = resolvedType === 'document' ? 'document.pdf' : 'image.jpg';
        }
        // Remove timestamp prefix if present (e.g. 1791549102213-call_logs.csv -> call_logs.csv)
        resolvedFilename = resolvedFilename.replace(/^\d{10,14}-/, '');

        const rawCaption = (textBody && typeof textBody === 'string') ? textBody.trim() : '';
        const trimmedCaption = (rawCaption && !['none', 'null', 'undefined', '[media]', '[document]'].includes(rawCaption.toLowerCase()) && resolvedType !== 'audio')
          ? rawCaption
          : null;

        // Resolve exact MIME type from URL and filename
        const urlAndNameLower = (cleanMediaUrl + ' ' + resolvedFilename).toLowerCase();
        let resolvedMimeType = resolvedType === 'document' ? 'application/pdf' : 'image/jpeg';

        if (urlAndNameLower.includes('.png')) resolvedMimeType = 'image/png';
        else if (urlAndNameLower.includes('.jpg') || urlAndNameLower.includes('.jpeg')) resolvedMimeType = 'image/jpeg';
        else if (urlAndNameLower.includes('.webp')) resolvedMimeType = 'image/webp';
        else if (urlAndNameLower.includes('.pdf')) resolvedMimeType = 'application/pdf';
        else if (urlAndNameLower.includes('.csv')) resolvedMimeType = 'text/csv';
        else if (urlAndNameLower.includes('.xlsx')) resolvedMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (urlAndNameLower.includes('.xls')) resolvedMimeType = 'application/vnd.ms-excel';
        else if (urlAndNameLower.includes('.docx')) resolvedMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (urlAndNameLower.includes('.doc')) resolvedMimeType = 'application/msword';
        else if (urlAndNameLower.includes('.txt')) resolvedMimeType = 'text/plain';
        else if (urlAndNameLower.includes('.zip')) resolvedMimeType = 'application/zip';
        else if (urlAndNameLower.includes('.mp3')) resolvedMimeType = 'audio/mpeg';
        else if (urlAndNameLower.includes('.mp4')) resolvedMimeType = 'video/mp4';

        const isUrl = cleanMediaUrl.startsWith('http://') || cleanMediaUrl.startsWith('https://');

        // Multi-strategy cascade for media dispatch
        const strategies = [
          // Strategy 0: If media ID / token from MyOperator vault (Documents)
          ...(!isUrl ? [
            {
              name: 'vault-media_id',
              data: {
                type: resolvedType,
                context: {
                  media_id: cleanMediaUrl,
                  mime_type: resolvedMimeType,
                  ...(resolvedType === 'document' ? { filename: resolvedFilename } : {}),
                  ...(trimmedCaption ? { caption: trimmedCaption } : {})
                }
              }
            }
          ] : [
            // Strategy 1: Public URL link with mime_type (Images & Direct URLs)
            {
              name: 'context-link-with-mime',
              data: {
                type: resolvedType,
                context: {
                  link: cleanMediaUrl,
                  mime_type: resolvedMimeType,
                  ...(resolvedType === 'document' ? { filename: resolvedFilename } : {}),
                  ...(trimmedCaption ? { caption: trimmedCaption } : {})
                }
              }
            },
            {
              name: 'context-link-no-caption',
              data: {
                type: resolvedType,
                context: {
                  link: cleanMediaUrl,
                  mime_type: resolvedMimeType,
                  ...(resolvedType === 'document' ? { filename: resolvedFilename } : {})
                }
              }
            }
          ])
        ];

        let lastError = null;
        for (const strategy of strategies) {
          try {
            const attemptPayload = {
              phone_number_id: targetPhoneNumId,
              customer_country_code: countryCode,
              customer_number: cleanPhone,
              data: strategy.data
            };
            console.log(`[MyOperator WABA] Trying Media (${resolvedType}) strategy "${strategy.name}" to +${countryCode}${cleanPhone}...`);
            const response = await axios.post(`${this.baseUrl}/chat/messages`, attemptPayload, { headers });
            console.log(`[MyOperator WABA] ✅ Media (${resolvedType}) dispatched successfully using "${strategy.name}":`, response.data);
            return response.data;
          } catch (err) {
            lastError = err;
            const errMsg = err.response?.data?.message || err.message;
            console.warn(`[MyOperator WABA] Strategy "${strategy.name}" failed: ${errMsg}`);
          }
        }

        // Strategy 6: Resilient Fallback (Guarantees customer receives file even if binary media is blocked)
        console.warn(`[MyOperator WABA] All binary media strategies failed (${lastError?.response?.data?.message || lastError?.message}). Falling back to direct secure file link text...`);
        const fallbackText = resolvedType === 'document'
          ? `📄 *[Document: ${resolvedFilename}]*\n${cleanMediaUrl}${trimmedCaption ? '\n\n' + trimmedCaption : ''}`
          : `🖼️ *[${resolvedType.toUpperCase()}]*\n${cleanMediaUrl}${trimmedCaption ? '\n\n' + trimmedCaption : ''}`;

        const textPayload = {
          phone_number_id: targetPhoneNumId,
          customer_country_code: countryCode,
          customer_number: cleanPhone,
          data: {
            type: 'text',
            context: {
              body: fallbackText,
              preview_url: true
            }
          }
        };

        const textRes = await axios.post(`${this.baseUrl}/chat/messages`, textPayload, { headers });
        console.log(`[MyOperator WABA] ✅ Fallback text link dispatched successfully:`, textRes.data);
        return textRes.data;
      } else {
        // Freeform Plain Text Message
        payload.data = {
          type: 'text',
          context: {
            body: textBody || '',
            preview_url: false
          }
        };

        console.log(`[MyOperator WABA] Dispatching Text to +${countryCode}${cleanPhone}:`, JSON.stringify(payload));

        const headers = this.getHeaders();
        const response = await axios.post(`${this.baseUrl}/chat/messages`, payload, { headers });

        return response.data;
      }
    } catch (error) {
      const errorData = error.response?.data;
      console.error('[MyOperator WABA API Error Status]:', error.response?.status);
      console.error('[MyOperator WABA API Error Details]:', JSON.stringify(errorData || error.message));
      const extractedError = (errorData && typeof errorData === 'object')
        ? (errorData.message || errorData.error?.message || (Array.isArray(errorData.errors) ? errorData.errors.map(e => e.message || JSON.stringify(e)).join(', ') : (errorData.errors ? JSON.stringify(errorData.errors) : null)) || error.message)
        : error.message;
      throw new Error(extractedError || 'Failed to dispatch WhatsApp message via MyOperator');
    }
  }

  /**
   * Mark incoming WhatsApp Message as Read in Meta / MyOperator WABA
   * Triggers the blue double checkmarks on customer's phone
   */
  async markMessageAsRead(params) {
    const messageId = typeof params === 'object' ? (params.messageId || params.wabaMessageId) : params;
    const wabaId = typeof params === 'object' ? (params.wabaMessageId || params.messageId) : params;
    if (!messageId && !wabaId) return false;

    const targetPhoneNumId = (await this.getPhoneNumberId()) || this.phoneNumberId || '1307352865799863';

    // 1. Direct Meta Graph API (triggers instant double blue checkmarks when Meta token is configured)
    const metaToken = process.env.META_WHATSAPP_TOKEN || process.env.WHATSAPP_CLOUD_API_TOKEN;
    if (metaToken && wabaId && wabaId.startsWith('wamid.')) {
      try {
        const response = await axios.post(
          `https://graph.facebook.com/v21.0/${targetPhoneNumId}/messages`,
          {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: wabaId.toString()
          },
          {
            headers: {
              'Authorization': `Bearer ${metaToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`[Meta WABA] 👁️ Sent direct blue tick read receipt for ${wabaId}:`, response.data);
        return true;
      } catch (metaErr) {
        console.warn(`[Meta WABA Read Receipt Error for ${wabaId}]:`, metaErr.response?.data || metaErr.message);
      }
    }

    return true;
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
      const targetPhoneNumId = (await this.getPhoneNumberId()) || this.phoneNumberId || '1307352865799863';

      // Determine robust MIME type from filename if octet-stream or missing
      let resolvedMime = mimeType;
      const fnLower = (fileName || '').toLowerCase();
      if (!resolvedMime || resolvedMime === 'application/octet-stream') {
        if (fnLower.endsWith('.pdf')) resolvedMime = 'application/pdf';
        else if (fnLower.endsWith('.png')) resolvedMime = 'image/png';
        else if (fnLower.endsWith('.jpg') || fnLower.endsWith('.jpeg')) resolvedMime = 'image/jpeg';
        else if (fnLower.endsWith('.webp')) resolvedMime = 'image/webp';
        else if (fnLower.endsWith('.csv')) resolvedMime = 'text/csv';
        else if (fnLower.endsWith('.xlsx')) resolvedMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        else if (fnLower.endsWith('.xls')) resolvedMime = 'application/vnd.ms-excel';
        else if (fnLower.endsWith('.docx')) resolvedMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (fnLower.endsWith('.doc')) resolvedMime = 'application/msword';
        else if (fnLower.endsWith('.txt')) resolvedMime = 'text/plain';
        else if (fnLower.endsWith('.zip')) resolvedMime = 'application/zip';
        else if (fnLower.endsWith('.mp3')) resolvedMime = 'audio/mpeg';
        else if (fnLower.endsWith('.mp4')) resolvedMime = 'video/mp4';
        else resolvedMime = 'application/pdf';
      }

      form.append('application', 'template');
      form.append('messaging_product', 'whatsapp');
      form.append('phone_number_id', targetPhoneNumId);
      form.append('type', resolvedMime);
      form.append('file', fileBuffer, {
        filename: fileName || 'document.pdf',
        contentType: resolvedMime,
        knownLength: fileBuffer.length
      });

      const headers = {
        ...this.getHeaders(),
        ...form.getHeaders()
      };

      const response = await axios.post(`${this.baseUrl}/chat/media/upload`, form, { headers });
      console.log('[MyOperator Media Vault Upload Success]:', JSON.stringify(response.data));
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
        const cleanPhone = normalizeIndianPhone(rawPhone);
        const phoneVariants = getPhoneQueryVariants(rawPhone);
        const customerName = c.customer_name || (`Customer ${cleanPhone.slice(-4)}`);

        let contact = await Contact.findOne({
          $or: [
            { phone: { $in: phoneVariants } },
            { phone: cleanPhone }
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

            const msgCreatedAt = m.created ? new Date(m.created) : new Date();
            const idList = [
              m.metadata?.waba_msg_id,
              m.id,
              m.message_id
            ].filter(Boolean).map(String);

            let existing = null;
            if (idList.length > 0) {
              existing = await Message.findOne({
                $or: [
                  { myoperatorMessageId: { $in: idList } },
                  { wabaMessageId: { $in: idList } }
                ]
              });
            }

            if (existing) {
              let needsSave = false;
              if (myopMsgId && String(myopMsgId).length <= 40 && !String(myopMsgId).startsWith('wamid.') && existing.myoperatorMessageId !== String(myopMsgId)) {
                existing.myoperatorMessageId = String(myopMsgId);
                needsSave = true;
              }
              if (m.metadata?.waba_msg_id && existing.wabaMessageId !== m.metadata.waba_msg_id) {
                existing.wabaMessageId = m.metadata.waba_msg_id;
                needsSave = true;
              }
              if (m.status && existing.status !== m.status) {
                existing.status = m.status;
                needsSave = true;
              }
              if (needsSave) {
                await existing.save().catch(() => {});
              }
            } else if (content) {
              const msgType = m.data?.type === 'template' ? 'template' : (m.data?.type || 'text');
              const newMsg = new Message({
                conversationId: conversation._id,
                contactId: contact._id,
                direction: direction,
                type: ['text', 'image', 'document', 'audio', 'video', 'template'].includes(msgType) ? msgType : 'text',
                content: content,
                replyTo: replyToObj,
                myoperatorMessageId: (myopMsgId && String(myopMsgId).length <= 40 && !String(myopMsgId).startsWith('wamid.')) ? String(myopMsgId) : undefined,
                wabaMessageId: m.metadata?.waba_msg_id || (myopMsgId?.startsWith('wamid.') ? myopMsgId : undefined),
                status: m.status === 'read' ? 'read' : (m.status === 'delivered' ? 'delivered' : (direction === 'incoming' ? 'delivered' : 'sent')),
                createdAt: msgCreatedAt
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
