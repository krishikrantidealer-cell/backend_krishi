const axios = require('axios');
const mongoose = require('mongoose');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
const wsService = require('../services/websocket.service');
const whatsappService = require('../services/whatsapp.service');
const myoperatorService = require('../services/myoperator.service');

/**
 * Enterprise Multi-Agent WhatsApp Template Controller
 * ─────────────────────────────────────────────────────────────
 * Provides scoped access:
 * - Sales Agents see: [Private Agent Templates] + [Company Global Templates]
 * - Admins see: All templates with full cross-agent management
 */

/**
 * List Templates (Scoped by Agent & Role)
 */
const getTemplates = async (req, res) => {
  try {
    const { category, status, scope, agentId, search, sync, page = 1, limit = 50 } = req.query;

    // ── 0. Live Sync from MyOperator Provider (On-demand or Force) ────────────
    if (sync === 'true' || sync === true) {
      try {
        const providerTemplates = await myoperatorService.getTemplates();
        if (Array.isArray(providerTemplates) && providerTemplates.length > 0) {
          for (const pt of providerTemplates) {
            const name = pt.name || pt.element_name;
            if (!name) continue;
            const rawCat = (pt.category || "UTILITY").toUpperCase();
            const validCategory = ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(rawCat) ? rawCat : "UTILITY";
            const language = pt.language || "en";
            const components = Array.isArray(pt.components) ? pt.components : [];

            let headerType = "NONE";
            let headerText = "";
            const headerComp = components.find(c => (c.type || "").toUpperCase() === "HEADER");
            if (headerComp) {
              headerType = (headerComp.format || "TEXT").toUpperCase();
              headerText = headerComp.text || "";
            }

            let body = pt.body || pt.data?.body || "";
            const bodyComp = components.find(c => (c.type || "").toUpperCase() === "BODY");
            if (bodyComp && bodyComp.text) {
              body = bodyComp.text;
            }
            if (!body) body = name;

            let footer = "";
            const footerComp = components.find(c => (c.type || "").toUpperCase() === "FOOTER");
            if (footerComp && footerComp.text) footer = footerComp.text;

            let ptStatus = "APPROVED";
            const rawStatus = (pt.waba_template_status || pt.status || "").toUpperCase();
            if (rawStatus.includes("REJECT")) ptStatus = "REJECTED";
            else if (rawStatus.includes("PEND")) ptStatus = "PENDING_APPROVAL";

            await WhatsAppTemplate.findOneAndUpdate(
              { name, language, isGlobal: true },
              {
                $set: {
                  name,
                  title: name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
                  category: validCategory,
                  language,
                  headerType: ["NONE", "TEXT", "IMAGE", "DOCUMENT", "VIDEO"].includes(headerType) ? headerType : "NONE",
                  headerText,
                  body,
                  footer,
                  status: ptStatus,
                  isGlobal: true,
                  providerTemplateId: pt.waba_template_id || pt.id
                },
                $setOnInsert: {
                  createdBy: req.user.id
                }
              },
              { upsert: true, returnDocument: 'after' }
            );
          }
        }
      } catch (syncErr) {
        console.warn('[MyOperator Template Sync Note]:', syncErr.message);
      }
    }

    const query = {};

    // ── 1. Multi-Agent Scoping ──────────────────────────────────────────────
    if (req.user.role === 'sales') {
      // Sales Agent sees: Global Company Templates + Their Own Private Templates
      query.$or = [
        { isGlobal: true },
        { createdBy: req.user.id },
        { agentId: req.user.id }
      ];
    } else if (req.user.role === 'admin') {
      // Admin can filter by agent or scope
      if (scope === 'global') {
        query.isGlobal = true;
      } else if (scope === 'agent' || agentId) {
        if (agentId && mongoose.Types.ObjectId.isValid(agentId)) {
          query.agentId = agentId;
          query.isGlobal = false;
        } else {
          query.isGlobal = false;
        }
      }
    }

    if (category && category !== 'ALL') {
      query.category = category.toUpperCase();
    }
    if (status && status !== 'ALL') {
      query.status = status.toUpperCase();
    }
    if (search && search.trim() !== '') {
      const regex = { $regex: search.trim(), $options: 'i' };
      const searchOr = [{ name: regex }, { title: regex }, { body: regex }, { headerText: regex }, { footer: regex }];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [templates, total] = await Promise.all([
      WhatsAppTemplate.find(query)
        .sort({ isGlobal: -1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('agentId', 'firstName lastName email phoneNumber')
        .populate('createdBy', 'firstName lastName email'),
      WhatsAppTemplate.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: templates,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get Template by ID
 */
const getTemplateById = async (req, res) => {
  try {
    const template = await WhatsAppTemplate.findById(req.params.id)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('createdBy', 'firstName lastName email');

    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    // Role check: Sales agent can only view global templates or their own
    if (req.user.role === 'sales' && !template.isGlobal) {
      const isOwner = (template.createdBy && template.createdBy._id.toString() === req.user.id) ||
                      (template.agentId && template.agentId._id.toString() === req.user.id);
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Not authorized to view this private template' });
      }
    }

    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Create a New WhatsApp Template
 */
const createTemplate = async (req, res) => {
  try {
    const {
      name,
      title = '',
      category = 'UTILITY',
      language = 'hi',
      headerType = 'NONE',
      headerText = '',
      headerMediaUrl = '',
      body,
      footer = '',
      buttons = [],
      sampleVariables = [],
      isGlobal = false,
      targetAgentId
    } = req.body;

    if (!name || !body) {
      return res.status(400).json({
        success: false,
        message: 'Template name and message body are required.'
      });
    }

    // Standardize name: lowercase letters, numbers, and underscores only
    const formattedName = name.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');

    // Resolve owner & telephony credentials
    let assignedAgentId = null;
    let assignedAgentPhone = '';
    let assignedCompanyId = '';
    let effectiveIsGlobal = false;

    if (req.user.role === 'admin') {
      effectiveIsGlobal = Boolean(isGlobal);
      if (!effectiveIsGlobal && targetAgentId) {
        assignedAgentId = targetAgentId;
        const targetUser = await User.findById(targetAgentId);
        assignedAgentPhone = targetUser?.phoneNumber || '';
        assignedCompanyId = targetUser?.myoperatorConfig?.companyId || '';
      }
    } else {
      // Sales agent creates private template by default
      effectiveIsGlobal = false;
      assignedAgentId = req.user.id;
      const agentUser = await User.findById(req.user.id);
      assignedAgentPhone = agentUser?.phoneNumber || '';
      assignedCompanyId = agentUser?.myoperatorConfig?.companyId || '';
    }

    // Check duplicate per agent scope
    const duplicateQuery = {
      name: formattedName,
      language,
      ...(effectiveIsGlobal ? { isGlobal: true } : { agentId: assignedAgentId })
    };
    const existing = await WhatsAppTemplate.findOne(duplicateQuery);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `A template with name "${formattedName}" (${language}) already exists in your workspace.`
      });
    }

    // Prepare components for Meta Graph API / WABA
    const metaComponents = [];

    if (headerType && headerType !== 'NONE') {
      const headerComp = { type: 'HEADER', format: headerType.toUpperCase() };
      if (headerType === 'TEXT' && headerText) {
        headerComp.text = headerText;
      } else if (['IMAGE', 'DOCUMENT', 'VIDEO'].includes(headerType)) {
        headerComp.example = {
          header_handle: [headerMediaUrl || 'https://krishikranti.com/public/sample_catalog.pdf']
        };
      }
      metaComponents.push(headerComp);
    }

    // Auto-generate sampleVariables if body has {{1}}, {{2}}...
    const varMatches = [...body.matchAll(/\{\{(\d+)\}\}/g)];
    let effectiveSampleVars = Array.isArray(sampleVariables) && sampleVariables.length > 0 ? sampleVariables : [];
    if (effectiveSampleVars.length === 0 && varMatches.length > 0) {
      effectiveSampleVars = varMatches.map((m, idx) => `Sample_${idx + 1}`);
    }

    const bodyComp = { type: 'BODY', text: body };
    if (effectiveSampleVars.length > 0) {
      bodyComp.example = { body_text: [effectiveSampleVars] };
    }
    metaComponents.push(bodyComp);

    if (footer && footer.trim()) {
      metaComponents.push({ type: 'FOOTER', text: footer.trim() });
    }

    if (Array.isArray(buttons) && buttons.length > 0) {
      const metaButtons = buttons.map(b => {
        if (b.type === 'URL') {
          return { type: 'URL', text: b.text, url: b.url };
        } else if (b.type === 'PHONE_NUMBER') {
          return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phoneNumber || b.phone_number };
        }
        return { type: 'QUICK_REPLY', text: b.text };
      });
      metaComponents.push({ type: 'BUTTONS', buttons: metaButtons });
    }

    let initialStatus = 'PENDING_APPROVAL';
    let providerTemplateId = null;
    let metaRejectionReason = null;

    // 1. Submit directly via MyOperator WABA Provider API
    if (myoperatorService.wabaKey) {
      try {
        const myopRes = await myoperatorService.createTemplate({
          name: formattedName,
          category: category.toUpperCase(),
          language,
          components: metaComponents
        });
        if (myopRes?.id || myopRes?.template_id || myopRes?.data?.id) {
          providerTemplateId = myopRes.id || myopRes.template_id || myopRes.data?.id;
          initialStatus = (myopRes.status || myopRes.data?.status || 'PENDING_APPROVAL').toUpperCase();
        }
      } catch (myopErr) {
        console.warn('[WhatsApp Template MyOperator Submission Note]:', myopErr.message);
        metaRejectionReason = myopErr.message;
      }
    }

    // 2. Fallback to Meta Cloud API if direct credentials exist
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

    if (!providerTemplateId && accessToken && wabaId) {
      try {
        const metaRes = await axios.post(`https://graph.facebook.com/v18.0/${wabaId}/message_templates`, {
          name: formattedName,
          category: category.toUpperCase(),
          language,
          components: metaComponents
        }, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 12000
        });

        if (metaRes.data?.id) {
          providerTemplateId = metaRes.data.id;
          initialStatus = (metaRes.data.status || 'PENDING_APPROVAL').toUpperCase();
        }
      } catch (metaErr) {
        console.warn('[WhatsApp Template Meta Submission Note]:', metaErr.response?.data?.error?.message || metaErr.message);
        if (!metaRejectionReason) metaRejectionReason = metaErr.response?.data?.error?.message || null;
      }
    }

    if (req.body.status === 'APPROVED') {
      initialStatus = 'APPROVED';
    }

    const template = new WhatsAppTemplate({
      name: formattedName,
      title: title || formattedName.replace(/_/g, ' ').toUpperCase(),
      category: category.toUpperCase(),
      language,
      headerType,
      headerText,
      headerMediaUrl,
      body,
      footer,
      buttons,
      sampleVariables,
      status: initialStatus,
      isGlobal: effectiveIsGlobal,
      agentId: assignedAgentId,
      agentPhone: assignedAgentPhone,
      companyId: assignedCompanyId,
      providerTemplateId,
      metaRejectionReason,
      createdBy: req.user.id
    });

    await template.save();

    const populated = await WhatsAppTemplate.findById(template._id)
      .populate('agentId', 'firstName lastName email phoneNumber')
      .populate('createdBy', 'firstName lastName email');

    // Broadcast template creation
    if (effectiveIsGlobal) {
      wsService.broadcastToRoles(['admin', 'sales'], {
        type: 'WHATSAPP_TEMPLATE_CREATED',
        data: populated
      });
    } else if (assignedAgentId) {
      wsService.sendToUser(assignedAgentId.toString(), {
        type: 'WHATSAPP_TEMPLATE_CREATED',
        data: populated
      });
      wsService.broadcastToRoles(['admin'], {
        type: 'WHATSAPP_TEMPLATE_CREATED',
        data: populated
      });
    }

    res.status(201).json({
      success: true,
      message: effectiveIsGlobal ? 'Company Global template created successfully!' : 'Private sales template created successfully!',
      data: populated
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete Template (Role & Ownership Guarded)
 */
const deleteTemplate = async (req, res) => {
  try {
    const template = await WhatsAppTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    if (req.user.role !== 'admin') {
      const isOwner = (template.createdBy && template.createdBy.toString() === req.user.id) ||
                      (template.agentId && template.agentId.toString() === req.user.id);
      if (!isOwner) {
        return res.status(403).json({ success: false, message: 'Not authorized to delete this template' });
      }
    }

    await WhatsAppTemplate.findByIdAndDelete(template._id);

    wsService.broadcastToRoles(['admin', 'sales'], {
      type: 'WHATSAPP_TEMPLATE_DELETED',
      data: { id: template._id }
    });

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Send a WhatsApp Template to Customer (1-Click Trigger)
 */
const sendTemplate = async (req, res) => {
  try {
    const { templateId, templateName, customerPhone, language = 'hi', variables = [] } = req.body;

    if (!customerPhone) {
      return res.status(400).json({ success: false, message: 'Customer phone number is required.' });
    }

    let templateObj = null;
    if (templateId) {
      templateObj = await WhatsAppTemplate.findById(templateId);
    } else if (templateName) {
      templateObj = await WhatsAppTemplate.findOne({
        name: templateName,
        $or: [{ isGlobal: true }, { agentId: req.user.id }, { createdBy: req.user.id }]
      });
    }

    const resolvedName = templateObj?.name || templateName;
    const resolvedLang = templateObj?.language || language;

    const sent = await whatsappService.sendTemplateMessage(customerPhone, resolvedName, resolvedLang, variables);

    if (sent) {
      res.json({
        success: true,
        message: `Template "${resolvedName}" sent successfully to ${customerPhone}`,
        data: { customerPhone, templateName: resolvedName }
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Could not dispatch WhatsApp message via carrier gateway.'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getTemplates,
  getTemplateById,
  createTemplate,
  deleteTemplate,
  sendTemplate
};
