const attributionService = require('../services/attribution.service');
const LeadTouch = require('../models/LeadTouch');
const LeadStageEvent = require('../models/LeadStageEvent');
const User = require('../models/User');

exports.getAttributionReport = async (req, res, next) => {
  try {
    const { startDate, endDate, channel, liveOnly, leadFormsOnly } = req.query;
    const report = await attributionService.getAttributionReport({
      startDate,
      endDate,
      channel: channel || 'all',
      liveOnly: liveOnly !== 'false',
      leadFormsOnly: leadFormsOnly !== 'false'
    });
    res.json({ success: true, ...report });
  } catch (error) {
    next(error);
  }
};

exports.syncAdSpend = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.body || {};
    const spendResult = await attributionService.syncDailyAdSpend({ startDate, endDate });
    const leadsResult = spendResult.skipped
      ? { syncedTouches: 0, matchedUsers: 0 }
      : await attributionService.syncMetaCampaignLeads({ maxPagesPerAd: 3 }).catch(() => ({
          syncedTouches: 0,
          matchedUsers: 0
        }));
    res.json({ success: true, ...spendResult, ...leadsResult });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.backfillTouches = async (req, res, next) => {
  try {
    const result = await attributionService.backfillHistoricalTouches();
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.upsertAdSpend = async (req, res, next) => {
  try {
    const doc = await attributionService.upsertAdSpend(req.body || {});
    res.json({ success: true, spend: doc });
  } catch (error) {
    next(error);
  }
};

exports.recordAppInstallReferrer = async (req, res, next) => {
  try {
    const {
      metaCampaignId,
      metaCampaignName,
      metaAdsetId,
      metaAdsetName,
      metaAdId,
      metaAdName,
      referrerPayload
    } = req.body || {};

    const user = req.user ? await User.findById(req.user._id) : null;
    const touch = await attributionService.recordTouch({
      user,
      phone: user?.phoneNumber || req.body?.phoneNumber,
      channel: 'app_install',
      metaCampaignId,
      metaCampaignName,
      metaAdsetId,
      metaAdsetName,
      metaAdId,
      metaAdName,
      platform: 'android',
      clickIdentifier: referrerPayload,
      rawPayload: req.body
    });

    res.json({ success: true, touchId: touch?._id || null });
  } catch (error) {
    next(error);
  }
};

exports.updateLeadStage = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { stage, dispositionReason } = req.body || {};
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }
    const event = await attributionService.recordStageEvent({
      user,
      stage,
      dispositionReason,
      agentId: req.user?._id
    });
    res.json({ success: true, event });
  } catch (error) {
    next(error);
  }
};

exports.getLeadAttributionTimeline = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const [touches, stages] = await Promise.all([
      LeadTouch.find({ lead: userId }).sort({ touchedAt: 1 }).lean(),
      LeadStageEvent.find({ lead: userId }).sort({ changedAt: 1 }).lean()
    ]);
    res.json({ success: true, touches, stages });
  } catch (error) {
    next(error);
  }
};
