/**
 * Helpers for generating and safely checking 6-digit email OTPs.
 *
 * We store an HMAC of the code (never the plain code) so that a leaked
 * database never exposes usable codes. HMAC (not bcrypt) is used deliberately:
 * bcrypt's slow hashing is meant to blunt offline brute force on the hash
 * itself, but a 6-digit code only has 1,000,000 possibilities either way —
 * the real defenses here are short expiry (10 min), a 3-attempt lockout,
 * and IP rate limiting (see middleware/rateLimiter.js). HMAC is fast and,
 * combined with a secret pepper, still prevents rainbow-table lookups.
 */
const crypto = require('crypto');

function getPepper() {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper) {
    // Fail loudly in production if the operator forgot to set a real secret.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('OTP_PEPPER must be set in production.');
    }
    return 'dev_only_otp_pepper_change_me';
  }
  return pepper;
}

// Cryptographically secure random 6-digit numeric code, zero-padded ("004821").
function generateOtp() {
  const n = crypto.randomInt(0, 1000000); // 0 .. 999999 inclusive
  return n.toString().padStart(6, '0');
}

// Hash bound to the email address too, so a hash for one address can never
// be replayed against another if the two OTPs happened to be equal by chance.
function hashOtp(code, email) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  return crypto
    .createHmac('sha256', getPepper())
    .update(`${normalizedEmail}:${code}`)
    .digest('hex');
}

// Constant-time comparison to avoid leaking match progress via timing.
function verifyOtp(code, email, storedHash) {
  const expected = hashOtp(code, email);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { generateOtp, hashOtp, verifyOtp };
