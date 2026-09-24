const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

router.post('/signup', authController.signup);
router.post('/login', authController.login);
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
