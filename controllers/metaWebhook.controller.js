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
/**
 * Extracts normalized form fields from Meta field_data array
 */
async function processLeadFields(fieldData) {
  let fullName = '';
  let firstNameVal = '';
  let lastNameVal = '';
  let phoneNumber = '';
  let shopName = '';
  let businessType = '';
  let state = '';
  let city = '';
  let pincode = '';
  let isHindiForm = false;
  const allFormAnswers = [];

  for (const field of fieldData) {
    const rawKey = field.name || '';
    const key = rawKey.toLowerCase().replace(/[\s_-]+/g, '_');
    const val = (field.values && field.values[0]) ? String(field.values[0]).trim() : '';

    if (!val) continue;

    allFormAnswers.push(`${rawKey}: ${val}`);

    // Check if Hindi text is present in key or value
    if (/[\u0900-\u097F]/.test(rawKey) || /[\u0900-\u097F]/.test(val)) {
      isHindiForm = true;
    }

    // Direct Value Matching for Business Type (e.g., "रिटेलर / दुकानदार", "होलसेलर", "डिस्ट्रीब्यूटर")
    if (
      val.includes('रिटेलर') || val.includes('दुकानदार') ||
      val.includes('होलसेलर') || val.includes('डिस्ट्रीब्यूटर') ||
      val.toLowerCase().includes('retailer') || val.toLowerCase().includes('wholesaler') || val.toLowerCase().includes('distributor')
    ) {
      businessType = val;
    }

    // Full name or first/last name matching (English & Hindi)
    if (
      key.includes('full_name') || key === 'fullname' ||
      rawKey.includes('पूरा नाम') || rawKey.includes('नाम') ||
      key.includes('name') && !key.includes('business') && !key.includes('shop')
    ) {
      fullName = val;
    } else if (key.includes('first_name') || key === 'firstname' || rawKey.includes('पहला नाम')) {
      firstNameVal = val;
    } else if (key.includes('last_name') || key === 'lastname' || rawKey.includes('उपनाम')) {
      lastNameVal = val;
    }

    // Phone / Mobile matching (English & Hindi)
    if (
      key.includes('phone') || key.includes('mobile') || key.includes('contact') || key.includes('whatsapp') ||
      rawKey.includes('फ़ोन') || rawKey.includes('फोन') || rawKey.includes('मोबाइल') || rawKey.includes('नंबर')
    ) {
      phoneNumber = val;
    }

    // Business type question (e.g., "आप किस प्रकार का कृषि व्यवसाय करते हैं?", "type_of_business", etc.)
    if (
      key.includes('type_of_business') || key.includes('business_type') || key.includes('what_type') ||
      key.includes('business_category') || key.includes('vyavasay') ||
      rawKey.includes('व्यवसाय') || rawKey.includes('प्रकार') || rawKey.includes('कृषि व्यवसाय')
    ) {
      if (!businessType) businessType = val;
    }

    // Shop / Store / Business name
    if (
      key.includes('shop_name') || key.includes('store_name') || key.includes('business_name') ||
      key.includes('company_name') || key.includes('firm_name') || rawKey.includes('दुकान का नाम') || rawKey.includes('कंपनी')
    ) {
      shopName = val;
    }

    // Address fields
    if (key.includes('state') || key.includes('pradesh') || rawKey.includes('राज्य')) {
      state = val;
    }
    if (key.includes('city') || key.includes('district') || key.includes('tehsil') || key.includes('town') || rawKey.includes('शहर') || rawKey.includes('जिला') || rawKey.includes('तहसील')) {
      city = val;
    }
    if (key.includes('pin') || key.includes('zip') || key.includes('postal') || rawKey.includes('पिनकोड')) {
      pincode = val;
    }
  }

  // If fullName wasn't explicit, combine first and last
  if (!fullName && (firstNameVal || lastNameVal)) {
    fullName = `${firstNameVal} ${lastNameVal}`.trim();
  }

  // If shopName not provided, use businessType (e.g. "रिटेलर / दुकानदार")
  if (!shopName && businessType) {
    shopName = businessType;
  }

  // Format notes from all questions in the form
  const customNotes = allFormAnswers.length > 0
    ? `📋 Meta Lead Form Submission:\n${allFormAnswers.map(a => `• ${a}`).join('\n')}`
    : '';

  await createOrUpdateProspectUser({
    phoneNumber,
    fullName,
    shopName,
    businessType,
    state,
    city,
    pincode,
    notes: customNotes,
    preferredLanguage: isHindiForm ? 'hi' : 'en'
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

  const defaultNote = data.notes || (data.businessType ? `Business Type: ${data.businessType}` : 'Source: Meta Lead Form');

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
      preferredLanguage: data.preferredLanguage || 'hi',
      isBlocked: false,
      isDeleted: false,
      whatsappSequence: 0,
      shippingAddresses: [],
      notesHistory: [
        {
          title: 'Lead Generated via Meta Ads',
          note: defaultNote,
          author: 'Meta Ads',
          createdAt: new Date(),
          type: 'general',
          priority: 'medium',
          status: 'prospect'
        }
      ],
      notes: defaultNote
    });

    console.log(`[Meta Lead Form] New prospect lead created: ${cleanPhone} (${user.shopName || user.firstName}, ${user.address?.cityTehsil || 'India'})`);
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

    if (defaultNote) {
      user.notes = user.notes ? `${user.notes}\n\n${defaultNote}` : defaultNote;
      user.notesHistory = user.notesHistory || [];
      user.notesHistory.push({
        title: 'Meta Lead Form Re-submission',
        note: defaultNote,
        author: 'Meta Ads',
        createdAt: new Date(),
        type: 'general',
        priority: 'medium',
        status: user.status || 'prospect'
      });
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
