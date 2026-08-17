const axios = require('axios');
const User = require('../models/User');
const { broadcastToRoles } = require('../services/websocket.service');

/**
 * 1. Meta Webhook Verification Handshake
 * Meta sends GET request with hub.mode, hub.verify_token, and hub.challenge
 */
exports.verifyMetaWebhook = (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'krishi_meta_leads_2026';

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[Meta Webhook] Verification successful!');
      return res.status(200).send(challenge);
    }
    console.warn('[Meta Webhook] Verification failed: Token mismatch');
    return res.sendStatus(403);
  } catch (err) {
    console.error('[Meta Webhook] Error during verification:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Helper to clean phone numbers into standard 10-digit format
 */
function normalizePhoneNumber(rawPhone) {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/[^\d]/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }
  return cleaned.length === 10 ? cleaned : cleaned;
}

/**
 * Helper to split full name into first and last name
 */
function splitFullName(fullName) {
  if (!fullName) return { firstName: 'Dealer', lastName: '' };
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] || 'Dealer';
  const lastName = parts.slice(1).join(' ') || '';
  return { firstName, lastName };
}

/**
 * 2. Meta Lead Webhook Receiver
 * Handles incoming leadgen webhook notifications from Facebook & Instagram
 */
exports.handleMetaLeadWebhook = async (req, res) => {
  // Always return 200 OK immediately so Meta does not retry
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    console.log('[Meta Webhook] Incoming payload:', JSON.stringify(body));

    // Handle Direct Test Payloads or standard Meta leadgen event
    if (body.object === 'page' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (!Array.isArray(entry.changes)) continue;

        for (const change of entry.changes) {
          if (change.field === 'leadgen' && change.value) {
            const leadgenId = change.value.leadgen_id;
            const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;

            let fieldData = [];

            if (leadgenId && pageAccessToken) {
              try {
                const graphUrl = `https://graph.facebook.com/v20.0/${leadgenId}?access_token=${pageAccessToken}`;
                const metaRes = await axios.get(graphUrl);
                fieldData = metaRes.data.field_data || [];
              } catch (graphErr) {
                console.error('[Meta Webhook] Failed to fetch lead data from Graph API:', graphErr.response?.data || graphErr.message);
              }
            } else if (change.value.field_data) {
              // Direct simulation payload
              fieldData = change.value.field_data;
            }

            if (fieldData.length > 0) {
              await processLeadFields(fieldData);
            }
          }
        }
      }
    } else if (body.field_data || body.phoneNumber) {
      // Direct mock/test format
      if (body.field_data) {
        await processLeadFields(body.field_data);
      } else {
        await createOrUpdateProspectUser({
          phoneNumber: body.phoneNumber,
          fullName: body.fullName || `${body.firstName || ''} ${body.lastName || ''}`,
          shopName: body.shopName,
          state: body.state,
          city: body.city || body.cityTehsil,
          pincode: body.pincode
        });
      }
    }
  } catch (err) {
    console.error('[Meta Webhook] Error processing lead:', err.message);
  }
};

/**
 * Extracts normalized form fields from Meta field_data array
 */
async function processLeadFields(fieldData) {
  let fullName = '';
  let phoneNumber = '';
  let shopName = '';
  let state = '';
  let city = '';
  let pincode = '';

  for (const field of fieldData) {
    const key = (field.name || '').toLowerCase();
    const val = (field.values && field.values[0]) ? String(field.values[0]).trim() : '';

    if (!val) continue;

    if (key.includes('full_name') || key === 'name' || key.includes('name')) {
      if (!fullName) fullName = val;
    }
    if (key.includes('phone') || key.includes('mobile') || key.includes('contact')) {
      phoneNumber = val;
    }
    if (key.includes('shop') || key.includes('store') || key.includes('business_name')) {
      shopName = val;
    }
    if (key.includes('state') || key.includes('pradesh')) {
      state = val;
    }
    if (key.includes('city') || key.includes('district') || key.includes('tehsil') || key.includes('town')) {
      city = val;
    }
    if (key.includes('pin') || key.includes('zip') || key.includes('postal')) {
      pincode = val;
    }
  }

  await createOrUpdateProspectUser({
    phoneNumber,
    fullName,
    shopName,
    state,
    city,
    pincode
  });
}

/**
 * Creates or updates a prospect User in MongoDB matching the exact required schema
 */
async function createOrUpdateProspectUser(data) {
  const cleanPhone = normalizePhoneNumber(data.phoneNumber);
  if (!cleanPhone || cleanPhone.length < 10) {
    console.warn('[Meta Webhook] Skipped lead with invalid phone number:', data.phoneNumber);
    return null;
  }

  const { firstName, lastName } = splitFullName(data.fullName);

  let user = await User.findOne({ phoneNumber: cleanPhone });

  if (!user) {
    user = await User.create({
      phoneNumber: cleanPhone,
      firstName: firstName || 'Dealer',
      lastName: lastName || '',
      shopName: data.shopName || '',
      address: {
        villageArea: '',
        cityTehsil: data.city || '',
        state: data.state || '',
        pincode: data.pincode || ''
      },
      addressType: 'Home',
      isVerified: true,
      isProfileComplete: false,
      role: 'user',
      userType: 'retailer',
      kycStatus: 'pending',
      isKycComplete: false,
      source: 'Meta Lead Form',
      status: 'prospect',
      monthlyTarget: 500000,
      preferredLanguage: 'en',
      isBlocked: false,
      isDeleted: false,
      whatsappSequence: 0,
      shippingAddresses: [],
      notesHistory: [],
      notes: ''
    });

    console.log(`[Meta Lead Form] New prospect lead created: ${cleanPhone} (${user.shopName}, ${user.address?.cityTehsil})`);
  } else {
    // If user already existed (e.g. from an earlier login or other lead source), update missing profile data
    let modified = false;
    if (!user.shopName && data.shopName) {
      user.shopName = data.shopName;
      modified = true;
    }
    if ((!user.firstName || user.firstName === 'Dealer') && firstName) {
      user.firstName = firstName;
      user.lastName = lastName;
      modified = true;
    }
    if (data.state || data.city || data.pincode) {
      user.address = user.address || {};
      if (data.state && !user.address.state) user.address.state = data.state;
      if (data.city && !user.address.cityTehsil) user.address.cityTehsil = data.city;
      if (data.pincode && !user.address.pincode) user.address.pincode = data.pincode;
      modified = true;
    }

    if (modified) {
      await user.save();
      console.log(`[Meta Lead Form] Updated existing user with Meta Form details: ${cleanPhone}`);
    }
  }

  // Real-time broadcast to KD Panel (Sales & Admin screens update immediately)
  try {
    broadcastToRoles(['admin', 'sales'], {
      type: 'LEADS_UPDATE',
      action: 'NEW_META_LEAD',
      leadId: user._id,
      user
    });
  } catch (wsErr) {
    console.error('[Meta Webhook] Failed to broadcast WebSocket update:', wsErr.message);
  }

  return user;
}
