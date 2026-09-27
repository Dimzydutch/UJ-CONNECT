/**
 * Rate limiters for the OTP endpoints. Keyed by IP (express-rate-limit's
 * default) since we need to throttle BEFORE trusting anything in the request
 * body — this is what stops someone from mass-emailing codes to arbitrary
 * addresses (spam/harassment) or hammering /verify-otp to brute-force a
 * 6-digit code.
 *
 * These sit alongside, not instead of, the per-account protections in
 * authController.js (60s resend cooldown, 3-attempt lockout, 10 min expiry).
 */
const rateLimit = require('express-rate-limit');

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 send/resend requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification code requests from this device. Please try again in a few minutes.' }
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // generous enough for typos, still bounded against brute force
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts from this device. Please try again later.' }
});

// Bonus: basic brute-force throttling on password login too.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again later.' }
});

const paymentRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many order or payment requests. Please try again later.' }
});

const payoutAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many bank account verification attempts. Please try again later.' }
});

module.exports = { otpRequestLimiter, otpVerifyLimiter, loginLimiter, paymentRequestLimiter, payoutAccountLimiter };
