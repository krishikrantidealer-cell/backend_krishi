/**
 * Normalizes Indian phone numbers to standard 10-digit format.
 * Examples:
 * "919171483518" -> "9171483518" (12 digits with 91 prefix)
 * "+91 91714 83518" -> "9171483518"
 * "09171483518"  -> "9171483518" (11 digits with 0 prefix)
 * "9171483518"   -> "9171483518" (10 digits starting with 91 - PRESERVED!)
 * "9876543210"   -> "9876543210" (10 digits)
 */
function normalizeIndianPhone(rawPhone) {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  if (digits.length === 8 && /^[6-9]/.test(digits)) {
    // Restores historical malformed 8-digit slice (e.g. 71483518 -> 9171483518)
    return `91${digits}`;
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

/**
 * Builds standard MongoDB search filter matching all possible representations
 * of a given phone number (10-digit, with 91, with +91, with 0, or legacy malformed slices)
 */
function getPhoneQueryVariants(rawPhone) {
  const clean10 = normalizeIndianPhone(rawPhone);
  if (!clean10) return [];
  const variants = [
    clean10,
    `91${clean10}`,
    `+91${clean10}`,
    `0${clean10}`
  ];
  if (rawPhone) {
    variants.push(String(rawPhone).trim());
  }
  // If clean10 begins with 91 (e.g. 9171483518), also match historical malformed 8-digit slice (71483518)
  if (clean10.length === 10 && clean10.startsWith('91')) {
    variants.push(clean10.slice(2));
  }
  return Array.from(new Set(variants.filter(Boolean)));
}

module.exports = {
  normalizeIndianPhone,
  getPhoneQueryVariants
};
