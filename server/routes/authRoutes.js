const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');
const { otpRequestLimiter, otpVerifyLimiter, loginLimiter } = require('../middleware/rateLimiter');

// Registration email-OTP flow (Step 1: send code, Step 2: verify code).
// /register/resend-otp reuses the same handler — it already detects a
// pending unverified account and issues it a fresh code.
router.post('/register/send-otp', otpRequestLimiter, authController.sendRegistrationOtp);
router.post('/register/resend-otp', otpRequestLimiter, authController.sendRegistrationOtp);
router.post('/register/verify-otp', otpVerifyLimiter, authController.verifyRegistrationOtp);

router.post('/login', loginLimiter, authController.login);
router.post('/login/verify-otp', otpVerifyLimiter, authController.verifyLoginOtp);
router.post('/verify-2fa', authController.verify2FA);
router.get('/me', verifyToken, authController.getMe);
router.put('/seller-profile', verifyToken, authController.updateSellerProfile);

// Two-factor authentication management (requires a full logged-in session)
router.get('/2fa/status', verifyToken, authController.get2FAStatus);
router.post('/2fa/setup', verifyToken, authController.setup2FA);
router.post('/2fa/enable', verifyToken, authController.enable2FA);
router.post('/2fa/disable', verifyToken, authController.disable2FA);
router.post('/2fa/backup-codes/regenerate', verifyToken, authController.regenerateBackupCodes);

module.exports = router;
