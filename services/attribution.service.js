const crypto = require('crypto');
const axios = require('axios');
const LeadTouch = require('../models/LeadTouch');
const LeadStageEvent = require('../models/LeadStageEvent');
const AdSpendDaily = require('../models/AdSpendDaily');
const User = require('../models/User');
const Order = require('../models/Order');

const adHierarchyCache = new Map();
let activeCampaignsCache = { ids: null, map: new Map(), expiresAt: 0 };
let lastTodaySpendSyncAt = 0;

function sha256(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

function normalizePhoneE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    return `+91${digits.slice(-10)}`;
  }
  return '';
}

class AttributionService {
  /**
   * Resolve ad -> adset -> campaign from Meta Graph API (cached).
   */
  async resolveMetaAdHierarchy(adId) {
    if (!adId) return {};
    if (adHierarchyCache.has(adId)) return adHierarchyCache.get(adId);

    const token = process.env.META_MARKETING_API_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return {};

    try {
      const url = `https://graph.facebook.com/v20.0/${adId}?fields=name,adset_id,adset{name},campaign_id,campaign{name}&access_token=${token}`;
      const res = await axios.get(url, { timeout: 8000 });
      const data = res.data || {};
      const resolved = {
        metaAdName: data.name || '',
        metaAdsetId: data.adset_id || data.adset?.id || '',
        metaAdsetName: data.adset?.name || '',
        metaCampaignId: data.campaign_id || data.campaign?.id || '',
        metaCampaignName: data.campaign?.name || ''
      };
      adHierarchyCache.set(adId, resolved);
      return resolved;
    } catch (err) {
      console.warn(`[Attribution] Could not resolve Meta ad hierarchy for ${adId}:`, err.response?.data?.error?.message || err.message);
      return {};
    }
  }

  /**
   * Classify lead quality from Meta Lead Form answers (per Nov 2026 Audit Plan).
   */
  classifyLeadQuality(formAnswers = [], businessType = '') {
    const joined = [
      businessType,
      ...(Array.isArray(formAnswers) ? formAnswers : Object.values(formAnswers || {}))
    ]
      .join(' ')
      .replace(/_/g, ' ')
      .toLowerCase();

    const hasShopMatch =
      joined.includes('has shop') ||
      joined.includes('retailer') ||
      joined.includes('wholesaler') ||
      joined.includes('distributor') ||
      joined.includes('रिटेलर') ||
      joined.includes('दुकानदार') ||
      joined.includes('होलसेलर') ||
      joined.includes('डिस्ट्रीब्यूटर') ||
      joined.includes('मेरी दुकान है') ||
      joined.includes('हाँ, मेरी दुकान');

    const planningMatch =
      joined.includes('planning to open') ||
      joined.includes('planning') ||
      joined.includes('खोलने की योजना');

    const farmerMatch =
      joined.includes('farmer') ||
      joined.includes('किसान');

    // Multi-select detection: more than one segment ticked
    const matchCount = [hasShopMatch, planningMatch, farmerMatch].filter(Boolean).length;
    if (matchCount > 1) {
      return {
        leadQuality: 'unqualified',
        disqualificationReason: 'Multi-select',
        normalizedBusinessType: 'multi_select'
      };
    }

    if (hasShopMatch) {
      return {
        leadQuality: 'qualified',
        disqualificationReason: null,
        normalizedBusinessType: businessType || 'has_shop'
      };
    }

    if (planningMatch) {
      return {
        leadQuality: 'low_intent',
        disqualificationReason: 'Planning shop',
        normalizedBusinessType: 'planning_shop'
      };
    }

    if (farmerMatch) {
      return {
        leadQuality: 'unqualified',
        disqualificationReason: 'Farmer',
        normalizedBusinessType: 'farmer'
      };
    }

    return {
      leadQuality: 'unknown',
      disqualificationReason: null,
      normalizedBusinessType: businessType || ''
    };
  }

  /**
   * Record an immutable ad touch. First-touch is preserved on the User; never overwritten.
   */
  async recordTouch({
    user,
    phone,
    channel,
    metaCampaignId,
    metaCampaignName,
    metaAdsetId,
    metaAdsetName,
    metaAdId,
    metaAdName,
    metaFormId,
    platform = 'unknown',
    clickIdentifier,
    formAnswers,
    rawPayload,
    touchedAt
  }) {
    try {
      const normalizedPhone = normalizePhoneE164(phone || user?.phoneNumber);
      let hierarchy = {};
      if (metaAdId && (!metaCampaignId || !metaAdsetId)) {
        hierarchy = await this.resolveMetaAdHierarchy(metaAdId);
      }

      const touch = await LeadTouch.create({
        lead: user?._id || undefined,
        phone: normalizedPhone,
        channel: channel || 'lead_form',
        metaCampaignId: metaCampaignId || hierarchy.metaCampaignId || undefined,
        metaCampaignName: metaCampaignName || hierarchy.metaCampaignName || undefined,
        metaAdsetId: metaAdsetId || hierarchy.metaAdsetId || undefined,
        metaAdsetName: metaAdsetName || hierarchy.metaAdsetName || undefined,
        metaAdId: metaAdId || undefined,
        metaAdName: metaAdName || hierarchy.metaAdName || undefined,
        metaFormId: metaFormId || undefined,
        platform,
        clickIdentifier: clickIdentifier || undefined,
        formAnswers,
        rawPayload,
        touchedAt: touchedAt || new Date()
      });

      if (user) {
        let modified = false;
        if (!user.firstTouchId) {
          user.firstTouchId = touch._id;
          modified = true;
        }
        if (!user.sourceChannel || user.sourceChannel === 'unknown') {
          user.sourceChannel = channel || 'lead_form';
          modified = true;
        }
        if (channel === 'lead_form' && clickIdentifier && !user.metaLeadId) {
          user.metaLeadId = clickIdentifier;
          modified = true;
        }
        if (channel === 'ctwa' && clickIdentifier && !user.ctwaClid) {
          user.ctwaClid = clickIdentifier;
          modified = true;
        }
        if (touch.metaCampaignId && !user.metaCampaignId) {
          user.metaCampaignId = touch.metaCampaignId;
          modified = true;
        }
        if (touch.metaAdsetId && !user.metaAdsetId) {
          user.metaAdsetId = touch.metaAdsetId;
          modified = true;
        }
        if (touch.metaAdId && !user.metaAdId) {
          user.metaAdId = touch.metaAdId;
          modified = true;
        }
        if (touch.metaFormId && !user.metaFormId) {
          user.metaFormId = touch.metaFormId;
          modified = true;
        }
        if (modified) {
          await user.save();
        }
      }

      try {
        const { broadcastToRoles } = require('./websocket.service');
        broadcastToRoles(['admin', 'marketing'], { type: 'ATTRIBUTION_UPDATE', channel: touch.channel });
      } catch (_) {}

      return touch;
    } catch (err) {
      console.error('[Attribution] recordTouch error:', err.message);
      return null;
    }
  }

  /**
   * Append a timestamped CRM stage event and fire Meta CAPI for qualified/purchase milestones.
   */
  async recordStageEvent({ user, stage, dispositionReason, agentId, metadata }) {
    if (!user || !user._id) return null;

    try {
      const eventDoc = await LeadStageEvent.create({
        lead: user._id,
        stage,
        dispositionReason: dispositionReason || undefined,
        agent: agentId || undefined,
        metadata: metadata || undefined,
        changedAt: new Date()
      });

      // Update user stage fields
      let modified = false;
      if (user.currentStage !== stage) {
        user.currentStage = stage;
        modified = true;
      }
      if (dispositionReason && user.disqualificationReason !== dispositionReason) {
        user.disqualificationReason = dispositionReason;
        modified = true;
      }
      if (stage === 'KYC verified' && !user.kycApprovedAt) {
        user.kycApprovedAt = new Date();
        modified = true;
      }
      if (stage === 'First order' && !user.firstOrderAt) {
        user.firstOrderAt = new Date();
        modified = true;
      }
      if (modified && typeof user.save === 'function') {
        await user.save();
      }

      // Fire Meta Conversions API (CAPI) on KYC verified & First order
      if (stage === 'KYC verified' || stage === 'First order' || stage === 'Repeat order') {
        const capiResult = await this.sendMetaCapiEvent({ user, stage, metadata });
        if (capiResult) {
          eventDoc.capiSent = Boolean(capiResult.sent);
          eventDoc.capiResponse = capiResult.response || { reason: capiResult.reason };
          await eventDoc.save();
        }
      }

      try {
        const { broadcastToRoles } = require('./websocket.service');
        broadcastToRoles(['admin', 'marketing'], { type: 'ATTRIBUTION_UPDATE', stage });
      } catch (_) {}

      return eventDoc;
    } catch (err) {
      console.error('[Attribution] recordStageEvent error:', err.message);
      return null;
    }
  }

  /**
   * Send CRM / Business Messaging conversion stage back to Meta CAPI.
   */
  async sendMetaCapiEvent({ user, stage, metadata = {} }) {
    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!pixelId || !accessToken) {
      return { sent: false, reason: 'META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not configured' };
    }

    const phoneHash = sha256(normalizePhoneE164(user.phoneNumber));
    const eventTime = Math.floor(Date.now() / 1000);
    const isPurchase = stage === 'First order' || stage === 'Repeat order';
    const isCtwa = user.sourceChannel === 'ctwa' || Boolean(user.ctwaClid);

    let payload;
    if (isCtwa && user.ctwaClid) {
      payload = {
        data: [
          {
            event_name: isPurchase ? 'Purchase' : 'QualifiedLead',
            event_time: eventTime,
            action_source: 'business_messaging',
            messaging_channel: 'whatsapp',
            user_data: {
              ctwa_clid: user.ctwaClid,
              ...(phoneHash ? { ph: [phoneHash] } : {})
            },
            custom_data: {
              currency: 'INR',
              ...(metadata.amount ? { value: Number(metadata.amount) } : {})
            }
          }
        ]
      };
    } else {
      payload = {
        data: [
          {
            event_name: isPurchase ? 'Purchase' : 'KYC_Verified',
            event_time: eventTime,
            action_source: 'system_generated',
            user_data: {
              ...(user.metaLeadId ? { lead_id: user.metaLeadId } : {}),
              ...(phoneHash ? { ph: [phoneHash] } : {})
            },
            custom_data: {
              event_source: 'crm',
              lead_event_source: 'Krishi Dealer CRM',
              currency: 'INR',
              ...(metadata.amount ? { value: Number(metadata.amount) } : {})
            }
          }
        ]
      };
    }

    try {
      const url = `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${accessToken}`;
      const res = await axios.post(url, payload, { timeout: 8000 });
      return { sent: true, response: res.data };
    } catch (err) {
      console.warn('[Meta CAPI] Event dispatch failed:', err.response?.data || err.message);
      return { sent: false, response: err.response?.data || err.message };
    }
  }

  /**
   * Sync daily campaign-level ad spend from Meta Marketing API Insights (fully paginated).
   */
  async syncDailyAdSpend({ startDate, endDate } = {}) {
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const token = process.env.META_MARKETING_API_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!adAccountId || !token) {
      return {
        synced: 0,
        skipped: true,
        message: 'META_AD_ACCOUNT_ID or META_MARKETING_API_TOKEN not configured in environment.'
      };
    }

    const maxLookback = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
    let since = startDate || maxLookback;
    if (since < maxLookback) since = maxLookback;
    const until = endDate || new Date().toISOString().slice(0, 10);

    try {
      const accountPath = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      let nextUrl = `https://graph.facebook.com/v20.0/${accountPath}/insights`;
      let params = {
        access_token: token,
        level: 'campaign',
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
        fields: 'date_start,campaign_id,campaign_name,spend,impressions,actions,objective',
        limit: 500
      };

      const bulkOps = [];
      let pageCount = 0;

      while (nextUrl && pageCount < 20) {
        pageCount++;
        const res = await axios.get(nextUrl, { params, timeout: 20000 });
        const rows = res.data?.data || [];

        for (const row of rows) {
          const objective = String(row.objective || '').toUpperCase();
          const campaignLower = String(row.campaign_name || '').toLowerCase();
          let channel = 'lead_form';
          if (campaignLower.includes('ctwa') || campaignLower.includes('whatsapp') || objective.includes('MESSAGES')) {
            channel = 'ctwa';
          } else if (objective.includes('APP_INSTALLS') || objective.includes('APP_PROMOTION') || campaignLower.includes('app')) {
            channel = 'app_install';
          }

          const leadAction = (row.actions || []).find(
            a => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped'
          );

          bulkOps.push({
            updateOne: {
              filter: {
                date: row.date_start,
                campaignId: row.campaign_id || '',
                adsetId: '',
                adId: ''
              },
              update: {
                $set: {
                  channel,
                  campaignName: row.campaign_name || '',
                  adsetName: '',
                  adName: '',
                  spend: Number(row.spend || 0),
                  impressions: Number(row.impressions || 0),
                  leads: Number(leadAction?.value || 0)
                }
              },
              upsert: true
            }
          });
        }

        nextUrl = res.data?.paging?.next || null;
        params = undefined; // nextUrl already carries query params
      }

      // Remove any old ad-level rows in this date window to prevent double counting
      await AdSpendDaily.deleteMany({
        date: { $gte: since, $lte: until },
        adId: { $ne: '' }
      });

      if (bulkOps.length > 0) {
        await AdSpendDaily.bulkWrite(bulkOps, { ordered: false });
      }

      return { synced: bulkOps.length, pages: pageCount, skipped: false, since, until };
    } catch (err) {
      console.error('[Attribution] syncDailyAdSpend failed:', err.response?.data || err.message);
      throw new Error(err.response?.data?.error?.message || err.message);
    }
  }

  /**
   * Sync ALL leads for active Lead-Form campaigns directly from Meta Ads API
   * and match them by last 10 digits of phone to MongoDB Users & Orders.
   */
  async syncMetaCampaignLeads({ maxPagesPerAd = 60 } = {}) {
    const token = process.env.META_MARKETING_API_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) {
      return { syncedTouches: 0, matchedUsers: 0, skipped: true };
    }

    const active = await this.getActiveMetaCampaigns();
    const leadCampaigns = Array.from(active.map.values()).filter(c => {
      const obj = String(c.objective || '').toUpperCase();
      const nameLower = String(c.name || '').toLowerCase();
      return (obj === 'OUTCOME_LEADS' || obj === 'LEAD_GENERATION') && !nameLower.includes('hiring') && !nameLower.includes('candidate');
    });

    if (leadCampaigns.length === 0) {
      return { syncedTouches: 0, matchedUsers: 0, campaignsChecked: 0 };
    }

    // Build fast phone10 -> User map from MongoDB
    const allUsers = await User.find({ role: 'user', isDeleted: { $ne: true } })
      .select('_id phoneNumber')
      .lean();
    const phoneToUserId = new Map();
    for (const u of allUsers) {
      const d = String(u.phoneNumber || '').replace(/\D/g, '');
      if (d.length >= 10) {
        phoneToUserId.set(d.slice(-10), u._id);
      }
    }

    let syncedTouches = 0;
    let matchedUsers = 0;

    for (const camp of leadCampaigns) {
      const adsRes = await axios.get(`https://graph.facebook.com/v20.0/${camp.id}/ads`, {
        params: { access_token: token, fields: 'id,name', limit: 100 },
        timeout: 15000
      });
      const ads = adsRes.data?.data || [];

      for (const ad of ads) {
        try {
          let nextUrl = `https://graph.facebook.com/v20.0/${ad.id}/leads`;
          let params = {
            access_token: token,
            fields: 'id,created_time,field_data,campaign_id,adset_id,ad_id,form_id,platform',
            limit: 100
          };
          let page = 0;
          const touchOps = [];
          const userOps = [];

          while (nextUrl && page < maxPagesPerAd) {
            page++;
            const leadsRes = await axios.get(nextUrl, { params, timeout: 20000 });
            const leads = leadsRes.data?.data || [];

            for (const lead of leads) {
              const fields = lead.field_data || [];
              const phoneField = fields.find(fd => {
                const n = String(fd.name || '').toLowerCase();
                return n.includes('phone') || n.includes('mobile') || n.includes('फ़ोन') || n.includes('फोन') || n.includes('मोबाइल');
              });
              const rawPhone = phoneField?.values?.[0] ? String(phoneField.values[0]).trim() : '';
              const digits = rawPhone.replace(/\D/g, '');
              const phone10 = digits.length >= 10 ? digits.slice(-10) : '';
              if (!phone10) continue;

              const e164 = `+91${phone10}`;
              const matchedUserId = phoneToUserId.get(phone10) || null;
              const formAnswers = fields.map(f => `${f.name}: ${(f.values || []).join(', ')}`);
              const quality = this.classifyLeadQuality(formAnswers, '');

              touchOps.push({
                updateOne: {
                  filter: { clickIdentifier: String(lead.id), channel: 'lead_form' },
                  update: {
                    $set: {
                      lead: matchedUserId || undefined,
                      phone: e164,
                      channel: 'lead_form',
                      metaCampaignId: String(lead.campaign_id || camp.id),
                      metaCampaignName: camp.name,
                      metaAdsetId: lead.adset_id ? String(lead.adset_id) : undefined,
                      metaAdId: lead.ad_id ? String(lead.ad_id) : String(ad.id),
                      metaAdName: ad.name || '',
                      metaFormId: lead.form_id ? String(lead.form_id) : undefined,
                      platform: lead.platform === 'ig' ? 'ig' : (lead.platform === 'fb' ? 'fb' : 'unknown'),
                      formAnswers,
                      touchedAt: lead.created_time ? new Date(lead.created_time) : new Date()
                    }
                  },
                  upsert: true
                }
              });

              if (matchedUserId) {
                matchedUsers++;
                userOps.push({
                  updateOne: {
                    filter: { _id: matchedUserId },
                    update: {
                      $set: {
                        sourceChannel: 'lead_form',
                        metaCampaignId: String(lead.campaign_id || camp.id),
                        metaLeadId: String(lead.id),
                        ...(quality.leadQuality !== 'unknown' ? { leadQuality: quality.leadQuality } : {}),
                        ...(quality.disqualificationReason ? { disqualificationReason: quality.disqualificationReason } : {})
                      }
                    }
                  }
                });
              }
            }

            nextUrl = leadsRes.data?.paging?.next || null;
            params = undefined;
          }

          if (touchOps.length > 0) {
            await LeadTouch.bulkWrite(touchOps, { ordered: false });
            syncedTouches += touchOps.length;
          }
          if (userOps.length > 0) {
            await User.bulkWrite(userOps, { ordered: false });
          }
        } catch (adErr) {
          console.warn(`[Attribution] Skipping leads sync for ad ${ad.id}:`, adErr.response?.data?.error?.message || adErr.message);
        }
      }
    }

    return {
      syncedTouches,
      matchedUsers,
      campaignsChecked: leadCampaigns.length
    };
  }

  /**
   * Fetch currently ACTIVE (live) Meta campaigns from Ads Manager (5-min cache).
   */
  async getActiveMetaCampaigns() {
    if (activeCampaignsCache.ids && Date.now() < activeCampaignsCache.expiresAt) {
      return activeCampaignsCache;
    }
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const token = process.env.META_MARKETING_API_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!adAccountId || !token) {
      return { ids: null, map: new Map() };
    }
    try {
      const accountPath = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const res = await axios.get(`https://graph.facebook.com/v20.0/${accountPath}/campaigns`, {
        params: {
          access_token: token,
          fields: 'id,name,effective_status,objective',
          limit: 200
        },
        timeout: 10000
      });
      const active = (res.data?.data || []).filter(c => c.effective_status === 'ACTIVE');
      const map = new Map(active.map(c => [String(c.id), c]));
      const ids = new Set(active.map(c => String(c.id)));
      activeCampaignsCache = { ids, map, expiresAt: Date.now() + 5 * 60 * 1000 };
      return activeCampaignsCache;
    } catch (err) {
      console.warn('[Attribution] Failed to fetch active Meta campaigns:', err.response?.data?.error?.message || err.message);
      return { ids: null, map: new Map() };
    }
  }

  /**
   * Unified Attribution & ROAS Report across Lead Forms, CTWA, and App Installs.
   */
  async getAttributionReport({ startDate, endDate, channel = 'all', liveOnly = true, leadFormsOnly = true } = {}) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Auto-sync today + yesterday Meta spend every 3 minutes when viewing current dates
    if (endStr >= todayStr && Date.now() - lastTodaySpendSyncAt > 3 * 60 * 1000) {
      lastTodaySpendSyncAt = Date.now();
      const yestStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      await this.syncDailyAdSpend({ startDate: yestStr, endDate: todayStr }).catch(() => {});
    }

    const activeCampaigns = liveOnly ? await this.getActiveMetaCampaigns() : { ids: null, map: new Map() };
    const allowedActiveIds = new Set();
    if (liveOnly && activeCampaigns.map.size > 0) {
      for (const [cid, cinfo] of activeCampaigns.map.entries()) {
        const nameLower = String(cinfo.name || '').toLowerCase();
        const obj = String(cinfo.objective || '').toUpperCase();
        const isLeadOrDealerCampaign =
          (obj === 'OUTCOME_LEADS' ||
            obj === 'LEAD_GENERATION' ||
            nameLower.includes('dealer')) &&
          !nameLower.includes('hiring') &&
          !nameLower.includes('candidate');

        if (leadFormsOnly && !isLeadOrDealerCampaign) continue;

        let ch = 'lead_form';
        if (nameLower.includes('ctwa') || nameLower.includes('whatsapp') || obj.includes('MESSAGES')) {
          ch = 'ctwa';
        } else if (obj.includes('APP_INSTALLS') || obj.includes('APP_PROMOTION') || nameLower.includes('app')) {
          ch = 'app_install';
        }
        if (channel && channel !== 'all' && ch !== channel) continue;
        allowedActiveIds.add(cid);
      }
    }

    const touchQuery = { touchedAt: { $gte: start, $lte: end } };
    const spendQuery = { date: { $gte: startStr, $lte: endStr } };
    if (channel && channel !== 'all') {
      touchQuery.channel = channel;
      spendQuery.channel = channel;
    }
    if (liveOnly && allowedActiveIds.size > 0) {
      touchQuery.metaCampaignId = { $in: Array.from(allowedActiveIds) };
      spendQuery.campaignId = { $in: Array.from(allowedActiveIds) };
    }

    const [touches, spends] = await Promise.all([
      LeadTouch.find(touchQuery).sort({ touchedAt: 1 }).lean(),
      AdSpendDaily.find(spendQuery).lean()
    ]);

    // First-touch acquisition credit per unique lead/phone
    const firstTouchByLeadKey = new Map();
    const rawLeadsByBucket = new Map();

    for (const t of touches) {
      const bucketKey = t.metaCampaignId || t.metaCampaignName || `${t.channel}_unattributed`;
      rawLeadsByBucket.set(bucketKey, (rawLeadsByBucket.get(bucketKey) || 0) + 1);

      const leadKey = t.lead ? String(t.lead) : (t.phone || String(t._id));
      if (!firstTouchByLeadKey.has(leadKey)) {
        firstTouchByLeadKey.set(leadKey, { touch: t, bucketKey });
      }
    }

    const leadIds = [];
    for (const { touch } of firstTouchByLeadKey.values()) {
      if (touch.lead) leadIds.push(touch.lead);
    }

    const [users, orders] = await Promise.all([
      leadIds.length > 0
        ? User.find({ _id: { $in: leadIds }, isDeleted: { $ne: true } })
            .select('_id kycStatus isKycComplete leadQuality disqualificationReason currentStage createdAt kycApprovedAt firstOrderAt')
            .lean()
        : [],
      leadIds.length > 0
        ? Order.find({
            user: { $in: leadIds },
            orderStatus: { $ne: 'Cancelled' },
            status: { $ne: 'cancelled' }
          })
            .select('user totalAmount orderStatus status orderSource source placedAt createdAt')
            .lean()
        : []
    ]);

    const userMap = new Map(users.map(u => [String(u._id), u]));
    const ordersByUser = new Map();
    for (const o of orders) {
      const uid = String(o.user);
      if (!ordersByUser.has(uid)) ordersByUser.set(uid, []);
      ordersByUser.get(uid).push(o);
    }

    const buckets = new Map();
    const ensureBucket = (key, defaults = {}) => {
      if (!buckets.has(key)) {
        buckets.set(key, {
          campaignId: defaults.campaignId || key,
          campaignName: defaults.campaignName || key,
          channel: defaults.channel || 'lead_form',
          spend: 0,
          impressions: 0,
          metaLeads: 0,
          rawLeads: rawLeadsByBucket.get(key) || 0,
          uniqueLeads: 0,
          contactedLeads: 0,
          qualifiedDealers: 0,
          orderingDealers: 0,
          repeatBuyers: 0,
          ordersCount: 0,
          appOrders: 0,
          panelOrders: 0,
          crossChannelBuyers: 0,
          totalGmv: 0,
          deliveredGmv: 0,
          rtoOrders: 0,
          qualityBreakdown: {
            qualified: 0,
            low_intent: 0,
            unqualified: 0,
            unknown: 0
          },
          disqualificationReasons: {}
        });
      }
      return buckets.get(key);
    };

    for (const s of spends) {
      const key = s.campaignId || s.campaignName || `${s.channel}_unattributed`;
      const b = ensureBucket(key, {
        campaignId: s.campaignId,
        campaignName: s.campaignName || s.campaignId,
        channel: s.channel
      });
      b.spend += Number(s.spend || 0);
      b.impressions += Number(s.impressions || 0);
      b.metaLeads += Number(s.leads || 0);
    }

    if (liveOnly && allowedActiveIds.size > 0) {
      for (const cid of allowedActiveIds) {
        const cinfo = activeCampaigns.map.get(cid);
        if (!cinfo) continue;
        const nameLower = String(cinfo.name || '').toLowerCase();
        const obj = String(cinfo.objective || '').toUpperCase();
        let ch = 'lead_form';
        if (nameLower.includes('ctwa') || nameLower.includes('whatsapp') || obj.includes('MESSAGES')) {
          ch = 'ctwa';
        } else if (obj.includes('APP_INSTALLS') || obj.includes('APP_PROMOTION') || nameLower.includes('app')) {
          ch = 'app_install';
        }
        ensureBucket(cid, { campaignId: cid, campaignName: cinfo.name, channel: ch });
      }
    }

    for (const { touch, bucketKey } of firstTouchByLeadKey.values()) {
      const b = ensureBucket(bucketKey, {
        campaignId: touch.metaCampaignId || bucketKey,
        campaignName: touch.metaCampaignName || (touch.channel === 'ctwa' ? 'CTWA WhatsApp' : 'Meta Lead Form'),
        channel: touch.channel
      });
      b.uniqueLeads += 1;

      const u = touch.lead ? userMap.get(String(touch.lead)) : null;
      if (u) {
        const q = u.leadQuality || 'unknown';
        b.qualityBreakdown[q] = (b.qualityBreakdown[q] || 0) + 1;
        if (u.disqualificationReason) {
          b.disqualificationReasons[u.disqualificationReason] =
            (b.disqualificationReasons[u.disqualificationReason] || 0) + 1;
        }
        if (u.currentStage && u.currentStage !== 'New') {
          b.contactedLeads += 1;
        }
        const isDealer = u.kycStatus === 'verified' || u.isKycComplete === true;
        if (isDealer) {
          b.qualifiedDealers += 1;
        }

        const userOrders = ordersByUser.get(String(u._id)) || [];
        const validOrders = userOrders.filter(o => new Date(o.placedAt || o.createdAt) >= new Date(touch.touchedAt));
        if (validOrders.length > 0) {
          b.orderingDealers += 1;
          if (validOrders.length > 1) {
            b.repeatBuyers += 1;
          }
          b.ordersCount += validOrders.length;
          let hasApp = false;
          let hasPanel = false;
          for (const o of validOrders) {
            const amt = Number(o.totalAmount || 0);
            const st = String(o.orderStatus || o.status || '').toLowerCase();
            const src = String(o.orderSource || o.source || '').toLowerCase();
            if (src === 'app') {
              b.appOrders += 1;
              hasApp = true;
            } else if (src === 'panel') {
              b.panelOrders += 1;
              hasPanel = true;
            }
            b.totalGmv += amt;
            if (st === 'delivered') {
              b.deliveredGmv += amt;
            } else if (st.includes('rto') || st.includes('returned')) {
              b.rtoOrders += 1;
            }
          }
          if (hasApp && hasPanel) {
            b.crossChannelBuyers += 1;
          }
        }
      }
    }

    let campaigns = Array.from(buckets.values()).map(b => {
      const effectiveLeads = b.uniqueLeads > 0 ? b.uniqueLeads : b.metaLeads;
      return {
        ...b,
        uniqueLeads: effectiveLeads,
        cpl: effectiveLeads > 0 ? Math.round(b.spend / effectiveLeads) : 0,
        leadToDealerPct: effectiveLeads > 0 ? Number(((b.qualifiedDealers / effectiveLeads) * 100).toFixed(1)) : 0,
        costPerQualifiedDealer: b.qualifiedDealers > 0 ? Math.round(b.spend / b.qualifiedDealers) : 0,
        firstOrderPct: effectiveLeads > 0 ? Number(((b.orderingDealers / effectiveLeads) * 100).toFixed(1)) : 0,
        dealerToOrderPct: b.qualifiedDealers > 0 ? Number(((b.orderingDealers / b.qualifiedDealers) * 100).toFixed(1)) : 0,
        costPerOrderingDealer: b.orderingDealers > 0 ? Math.round(b.spend / b.orderingDealers) : 0,
        repeatRatePct: b.orderingDealers > 0 ? Number(((b.repeatBuyers / b.orderingDealers) * 100).toFixed(1)) : 0,
        deliveredRoas: b.spend > 0 ? Number((b.deliveredGmv / b.spend).toFixed(2)) : 0,
        rtoPct: b.ordersCount > 0 ? Number(((b.rtoOrders / b.ordersCount) * 100).toFixed(1)) : 0
      };
    });

    if (liveOnly && activeCampaigns.ids) {
      campaigns = campaigns.filter(c => allowedActiveIds.has(String(c.campaignId)));
    }

    const totals = campaigns.reduce(
      (acc, c) => {
        acc.spend += c.spend;
        acc.rawLeads += c.rawLeads;
        acc.uniqueLeads += c.uniqueLeads;
        acc.qualifiedDealers += c.qualifiedDealers;
        acc.orderingDealers += c.orderingDealers;
        acc.repeatBuyers += c.repeatBuyers || 0;
        acc.ordersCount += c.ordersCount;
        acc.appOrders += c.appOrders || 0;
        acc.panelOrders += c.panelOrders || 0;
        acc.crossChannelBuyers += c.crossChannelBuyers || 0;
        acc.totalGmv += c.totalGmv;
        acc.deliveredGmv += c.deliveredGmv;
        acc.rtoOrders += c.rtoOrders;
        if (c.qualityBreakdown) {
          acc.qualityBreakdown.qualified += c.qualityBreakdown.qualified || 0;
          acc.qualityBreakdown.low_intent += c.qualityBreakdown.low_intent || 0;
          acc.qualityBreakdown.unqualified += c.qualityBreakdown.unqualified || 0;
          acc.qualityBreakdown.unknown += c.qualityBreakdown.unknown || 0;
        }
        if (c.disqualificationReasons) {
          for (const [reason, cnt] of Object.entries(c.disqualificationReasons)) {
            acc.disqualificationReasons[reason] = (acc.disqualificationReasons[reason] || 0) + cnt;
          }
        }
        return acc;
      },
      {
        spend: 0,
        rawLeads: 0,
        uniqueLeads: 0,
        qualifiedDealers: 0,
        orderingDealers: 0,
        repeatBuyers: 0,
        ordersCount: 0,
        appOrders: 0,
        panelOrders: 0,
        crossChannelBuyers: 0,
        totalGmv: 0,
        deliveredGmv: 0,
        rtoOrders: 0,
        qualityBreakdown: { qualified: 0, low_intent: 0, unqualified: 0, unknown: 0 },
        disqualificationReasons: {}
      }
    );

    const latestSpendDoc = spends.reduce((latest, s) => {
      const ts = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
      return ts > latest ? ts : latest;
    }, 0);

    return {
      range: { startDate: startStr, endDate: endStr, channel },
      lastSyncedAt: latestSpendDoc ? new Date(latestSpendDoc).toISOString() : new Date().toISOString(),
      totals: {
        ...totals,
        cpl: totals.uniqueLeads > 0 ? Math.round(totals.spend / totals.uniqueLeads) : 0,
        leadToDealerPct: totals.uniqueLeads > 0 ? Number(((totals.qualifiedDealers / totals.uniqueLeads) * 100).toFixed(1)) : 0,
        costPerQualifiedDealer: totals.qualifiedDealers > 0 ? Math.round(totals.spend / totals.qualifiedDealers) : 0,
        dealerToOrderPct: totals.qualifiedDealers > 0 ? Number(((totals.orderingDealers / totals.qualifiedDealers) * 100).toFixed(1)) : 0,
        costPerOrderingDealer: totals.orderingDealers > 0 ? Math.round(totals.spend / totals.orderingDealers) : 0,
        repeatRatePct: totals.orderingDealers > 0 ? Number(((totals.repeatBuyers / totals.orderingDealers) * 100).toFixed(1)) : 0,
        deliveredRoas: totals.spend > 0 ? Number((totals.deliveredGmv / totals.spend).toFixed(2)) : 0,
        rtoPct: totals.ordersCount > 0 ? Number(((totals.rtoOrders / totals.ordersCount) * 100).toFixed(1)) : 0
      },
      campaigns: campaigns.sort((a, b) => b.uniqueLeads - a.uniqueLeads)
    };
  }

  /**
   * Backfill historical User records into LeadTouch so existing campaigns,
   * KYC verified dealers, and orders appear in Attribution & ROAS immediately.
   */
  async backfillHistoricalTouches() {
    const users = await User.find({
      role: 'user',
      isDeleted: { $ne: true },
      firstTouchId: { $in: [null, undefined] }
    })
      .select('_id phoneNumber source sourceChannel metaCampaignId metaAdsetId metaAdId metaFormId metaLeadId ctwaClid notes businessType createdAt kycStatus isKycComplete kycApprovedAt')
      .lean();

    if (users.length === 0) {
      return { backfilled: 0 };
    }

    const touchOps = [];
    const userUpdates = [];

    for (const u of users) {
      const src = String(u.source || 'App');
      let channel = 'organic';
      let platform = 'unknown';
      let campaignName = src;

      if (src === 'Meta Lead Form') {
        channel = 'lead_form';
        campaignName = u.metaCampaignId || 'Meta Lead Form';
      } else if (src === 'Apps.facebook.com Ads') {
        channel = 'app_install';
        platform = 'fb';
        campaignName = 'Facebook App Ads';
      } else if (src === 'Apps.instagram.com Ads') {
        channel = 'app_install';
        platform = 'ig';
        campaignName = 'Instagram App Ads';
      } else if (src === 'Google Ads') {
        channel = 'app_install';
        platform = 'android';
        campaignName = 'Google Ads';
      } else if (src === 'KD Panel') {
        channel = 'referral';
        campaignName = 'KD Panel Direct';
      } else if (src === 'App') {
        channel = 'app_install';
        platform = 'android';
        campaignName = 'Krishi Dealer App';
      } else {
        channel = 'organic';
        campaignName = 'Organic';
      }

      const touchId = new (require('mongoose').Types.ObjectId)();
      const quality = u.notes ? this.classifyLeadQuality([u.notes], u.businessType || '') : { leadQuality: 'unknown' };

      touchOps.push({
        _id: touchId,
        lead: u._id,
        phone: normalizePhoneE164(u.phoneNumber),
        channel,
        metaCampaignId: u.metaCampaignId || campaignName,
        metaCampaignName: campaignName,
        metaAdsetId: u.metaAdsetId || undefined,
        metaAdId: u.metaAdId || undefined,
        metaFormId: u.metaFormId || undefined,
        platform,
        clickIdentifier: u.metaLeadId || u.ctwaClid || undefined,
        touchedAt: u.createdAt || new Date()
      });

      userUpdates.push({
        updateOne: {
          filter: { _id: u._id },
          update: {
            $set: {
              firstTouchId: touchId,
              sourceChannel: channel === 'referral' ? 'panel' : channel,
              ...(quality.leadQuality !== 'unknown' ? { leadQuality: quality.leadQuality } : {}),
              ...(quality.disqualificationReason ? { disqualificationReason: quality.disqualificationReason } : {}),
              ...(u.kycStatus === 'verified' || u.isKycComplete ? { currentStage: 'KYC verified' } : {})
            }
          }
        }
      });
    }

    if (touchOps.length > 0) {
      await LeadTouch.insertMany(touchOps, { ordered: false });
    }
    if (userUpdates.length > 0) {
      await User.bulkWrite(userUpdates, { ordered: false });
    }

    return { backfilled: touchOps.length };
  }

  /**
   * Upsert manual/CSV daily or campaign ad spend.
   */
  async upsertAdSpend({ date, channel = 'lead_form', campaignId, campaignName, spend = 0, leads = 0 }) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const cid = campaignId || campaignName || 'Meta Lead Form';
    return AdSpendDaily.findOneAndUpdate(
      { date: targetDate, campaignId: cid, adsetId: '', adId: '' },
      {
        $set: {
          channel,
          campaignName: campaignName || cid,
          spend: Number(spend || 0),
          leads: Number(leads || 0)
        }
      },
      { upsert: true, new: true }
    );
  }
}

module.exports = new AttributionService();
