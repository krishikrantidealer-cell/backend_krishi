const pincodesData = require('india-pincode-lookup/pincodes.json');

const locationStateToDistrictMap = new Map();
const locationToDistrictMap = new Map();
const pincodeToDistrictMap = new Map();
const pincodeToStateMap = new Map();

// Canonical state names from India Post (normalized for consistent output)
const STATE_NAME_CORRECTIONS = {
  'andhra pradesh': 'Andhra Pradesh',
  'arunachal pradesh': 'Arunachal Pradesh',
  'assam': 'Assam',
  'bihar': 'Bihar',
  'chhattisgarh': 'Chhattisgarh',
  'goa': 'Goa',
  'gujarat': 'Gujarat',
  'haryana': 'Haryana',
  'himachal pradesh': 'Himachal Pradesh',
  'jharkhand': 'Jharkhand',
  'karnataka': 'Karnataka',
  'kerala': 'Kerala',
  'madhya pradesh': 'Madhya Pradesh',
  'maharashtra': 'Maharashtra',
  'manipur': 'Manipur',
  'meghalaya': 'Meghalaya',
  'mizoram': 'Mizoram',
  'nagaland': 'Nagaland',
  'odisha': 'Odisha',
  'orissa': 'Odisha',
  'punjab': 'Punjab',
  'rajasthan': 'Rajasthan',
  'sikkim': 'Sikkim',
  'tamil nadu': 'Tamil Nadu',
  'telangana': 'Telangana',
  'tripura': 'Tripura',
  'uttar pradesh': 'Uttar Pradesh',
  'uttarakhand': 'Uttarakhand',
  'west bengal': 'West Bengal',
  'andaman and nicobar islands': 'Andaman & Nicobar',
  'chandigarh': 'Chandigarh',
  'dadra and nagar haveli and daman and diu': 'Dadra & NH and DD',
  'dadra and nagar haveli': 'Dadra & NH and DD',
  'daman and diu': 'Dadra & NH and DD',
  'delhi': 'Delhi',
  'jammu and kashmir': 'Jammu & Kashmir',
  'ladakh': 'Ladakh',
  'lakshadweep': 'Lakshadweep',
  'puducherry': 'Puducherry',
  'pondicherry': 'Puducherry',
};

// Abbreviation / script alias map for state names (covers Hindi, Gujarati, Marathi etc.)
const STATE_INPUT_ALIASES = {
  // Common abbreviations
  'mp': 'Madhya Pradesh', 'up': 'Uttar Pradesh', 'mh': 'Maharashtra',
  'gj': 'Gujarat', 'rj': 'Rajasthan', 'ka': 'Karnataka',
  'tn': 'Tamil Nadu', 'tg': 'Telangana', 'ap': 'Andhra Pradesh',
  'wb': 'West Bengal', 'pb': 'Punjab', 'hr': 'Haryana',
  'hp': 'Himachal Pradesh', 'uk': 'Uttarakhand', 'jh': 'Jharkhand',
  'br': 'Bihar', 'cg': 'Chhattisgarh', 'or': 'Odisha', 'kl': 'Kerala',
  'as': 'Assam', 'dl': 'Delhi',
  // Hindi / regional scripts
  'madhyapradesh': 'Madhya Pradesh', 'uttarpradesh': 'Uttar Pradesh',
  'मध्यप्रदेश': 'Madhya Pradesh', 'मध्य प्रदेश': 'Madhya Pradesh',
  'उत्तरप्रदेश': 'Uttar Pradesh', 'उत्तर प्रदेश': 'Uttar Pradesh',
  'महाराष्ट्र': 'Maharashtra', 'गुजरात': 'Gujarat', 'राजस्थान': 'Rajasthan',
  'कर्नाटक': 'Karnataka', 'तेलंगाना': 'Telangana', 'तमिलनाडु': 'Tamil Nadu',
  'हरियाणा': 'Haryana', 'पंजाब': 'Punjab', 'केरल': 'Kerala',
  'पश्चिम बंगाल': 'West Bengal', 'पश्चिमबंगाल': 'West Bengal',
  'आंध्र प्रदेश': 'Andhra Pradesh', 'आंध्रप्रदेश': 'Andhra Pradesh',
  'छत्तीसगढ़': 'Chhattisgarh', 'झारखंड': 'Jharkhand', 'उत्तराखंड': 'Uttarakhand',
  'हिमाचल प्रदेश': 'Himachal Pradesh', 'असम': 'Assam', 'बिहार': 'Bihar',
  'ओडिशा': 'Odisha', 'दिल्ली': 'Delhi', 'गोवा': 'Goa',
  // Gujarati
  'ગુજરાત': 'Gujarat', 'મધ્ય પ્રદેશ': 'Madhya Pradesh', 'રાજસ્થાન': 'Rajasthan',
  'ઉત્તર પ્રદેશ': 'Uttar Pradesh', 'મહારાષ્ટ્ર': 'Maharashtra',
  // Tamil
  'தமிழ்நாடு': 'Tamil Nadu', 'தெலங்கானா': 'Telangana', 'கேரளா': 'Kerala',
  'கர்நாடகா': 'Karnataka',
  // Telugu
  'తెలంగాణ': 'Telangana', 'ఆంధ్ర ప్రదేశ్': 'Andhra Pradesh',
  'మహారాష్ట్ర': 'Maharashtra', 'కర్ణాటక': 'Karnataka',
  // Kannada
  'ಕರ್ನಾಟಕ': 'Karnataka', 'ಮಹಾರಾಷ್ಟ್ರ': 'Maharashtra',
  'ತೆಲಂಗಾಣ': 'Telangana', 'ತಮಿಳುನಾಡು': 'Tamil Nadu',
  // Bengali
  'পশ্চিমবঙ্গ': 'West Bengal', 'মহারাষ্ট্র': 'Maharashtra',
  // Punjabi
  'ਪੰਜਾਬ': 'Punjab', 'ਮਹਾਰਾਸ਼ਟਰ': 'Maharashtra',
};

function cleanGeoKey(str) {
  if (!str) return '';
  return str.toString().replace(/[\s\u00A0._\-]+/g, '').toLowerCase();
}

// Build state key -> canonical state map from all unique states in the dataset
const stateNameMap = new Map(); // cleanKey -> canonical state name

// Automatically index all 154,823+ post offices, talukas, and towns across India on startup (~100ms)
for (const entry of pincodesData) {
  const dist = entry.districtName;
  const st = entry.stateName || '';
  if (!dist) continue;

  const cleanSt = cleanGeoKey(st);

  // Build state name lookup from dataset state names
  if (st && !stateNameMap.has(cleanSt)) {
    const stLower = st.toLowerCase();
    const canonical = STATE_NAME_CORRECTIONS[stLower] || (st.charAt(0).toUpperCase() + st.slice(1).toLowerCase());
    stateNameMap.set(cleanSt, canonical);
  }

  if (entry.pincode) {
    pincodeToDistrictMap.set(entry.pincode.toString().trim(), dist);
    if (!pincodeToStateMap.has(entry.pincode.toString().trim())) {
      pincodeToStateMap.set(entry.pincode.toString().trim(), st);
    }
  }

  if (entry.taluk && entry.taluk !== 'NA') {
    const k = cleanGeoKey(entry.taluk);
    if (cleanSt) locationStateToDistrictMap.set(k + '_' + cleanSt, dist);
    if (!locationToDistrictMap.has(k)) locationToDistrictMap.set(k, dist);
  }

  if (entry.officeName) {
    const rawName = entry.officeName.replace(/\s+(B\.O|S\.O|H\.O)$/i, '');
    const k = cleanGeoKey(rawName);
    if (cleanSt) locationStateToDistrictMap.set(k + '_' + cleanSt, dist);
    if (!locationToDistrictMap.has(k)) locationToDistrictMap.set(k, dist);
  }
}

// Also index the alias map keys into stateNameMap
for (const [alias, canonical] of Object.entries(STATE_INPUT_ALIASES)) {
  stateNameMap.set(cleanGeoKey(alias), canonical);
}

/**
 * Automatically normalizes any state input string (abbreviation, Hindi/regional script, full name)
 * to the official canonical English state name.
 */
function autoIdentifyState(input) {
  if (!input || typeof input !== 'string') return '';
  const cleaned = input.trim();
  if (!cleaned) return '';

  // Reject pure numeric strings (phone numbers, IDs, pincodes stored in state field)
  if (/^\d+$/.test(cleaned)) return '';
  if (cleaned.length < 2) return '';

  const k = cleanGeoKey(cleaned);

  // Direct alias match
  if (stateNameMap.has(k)) return stateNameMap.get(k);

  // Noise-stripped match (strip "Pradesh", "Rajya" suffix noise)
  const stripped = cleaned
    .replace(/\b(pradesh|rajya|state|राज्य|प्रदेश)\b/gi, '')
    .trim();
  const kStripped = cleanGeoKey(stripped);
  if (kStripped && stateNameMap.has(kStripped)) return stateNameMap.get(kStripped);

  // Multi-part split (e.g. "M.P." or "MP, India")
  const parts = cleaned.split(/[,()/]+/).map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const kp = cleanGeoKey(part);
    if (stateNameMap.has(kp)) return stateNameMap.get(kp);
  }

  // Return input as-is with title case if nothing matched
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Automatically identifies ANY input string (pincode, village, tehsil, city, town)
 * and resolves it to its official parent District in India.
 */
function autoIdentifyDistrict(input, stateContext = '') {
  if (!input || typeof input !== 'string') return '';
  const cleaned = input.trim();
  if (!cleaned) return '';

  // Reject: pure numbers (phone numbers, IDs), or strings shorter than 2 chars
  // Only allow 6-digit pincodes through the numeric path
  if (/^\d+$/.test(cleaned) && cleaned.length !== 6) return '';
  if (cleaned.length < 2) return '';

  // 1. Check 6-digit Pincode
  if (/^\d{6}$/.test(cleaned)) {
    const pincodeMatch = pincodeToDistrictMap.get(cleaned);
    if (pincodeMatch) return pincodeMatch;
  }

  // 2. Check multi-part strings (e.g. "Maihar, Satna" or "Pauni (Bhandara)")
  const parts = cleaned.split(/[,()/\\-]+/).map(p => p.trim()).filter(Boolean);
  const cleanSt = cleanGeoKey(stateContext);

  for (const part of parts) {
    const k = cleanGeoKey(part);
    if (cleanSt && locationStateToDistrictMap.has(k + '_' + cleanSt)) {
      return locationStateToDistrictMap.get(k + '_' + cleanSt);
    }
    if (locationToDistrictMap.has(k)) {
      return locationToDistrictMap.get(k);
    }
  }

  // 3. Strip noise words (tehsil, taluka, district, jilla, etc.)
  let stripped = cleaned
    .replace(/\b(tehsil|tahsil|taluka|taluk|district|dist|block|mandal|gram|panchayat|city|town|jilla|jila)\b/gi, '')
    .trim();

  if (!stripped) stripped = cleaned;
  const k = cleanGeoKey(stripped);

  if (cleanSt && locationStateToDistrictMap.has(k + '_' + cleanSt)) {
    return locationStateToDistrictMap.get(k + '_' + cleanSt);
  }
  if (locationToDistrictMap.has(k)) {
    return locationToDistrictMap.get(k);
  }

  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

module.exports = {
  autoIdentifyDistrict,
  autoIdentifyState,
  cleanGeoKey
};
