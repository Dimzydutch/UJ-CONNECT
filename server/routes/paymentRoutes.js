const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middleware/auth');
const { paymentRequestLimiter, payoutAccountLimiter } = require('../middleware/rateLimiter');

router.get('/banks', verifyToken, paymentController.getBanks);
router.get('/bank-account', verifyToken, paymentController.getBankAccount);
router.post('/bank-account/resolve', verifyToken, payoutAccountLimiter, paymentController.resolveBankAccount);
router.put('/bank-account', verifyToken, payoutAccountLimiter, paymentController.linkBankAccount);
router.put('/seller-onboarding', verifyToken, payoutAccountLimiter, paymentController.completeSellerOnboarding);

router.get('/orders', verifyToken, paymentController.getOrders);
router.post('/orders', verifyToken, paymentRequestLimiter, paymentController.createOrder);
router.patch('/orders/:id/quote', verifyToken, paymentRequestLimiter, paymentController.quoteOrder);
router.post('/orders/:id/checkout', verifyToken, paymentRequestLimiter, paymentController.startCheckout);
router.post('/orders/:id/verify', verifyToken, paymentRequestLimiter, paymentController.verifyOrderPayment);
router.post('/orders/:id/confirm-received', verifyToken, paymentRequestLimiter, paymentController.confirmReceived);
router.post('/orders/:id/retry-payout', verifyToken, paymentRequestLimiter, paymentController.retryPayout);
router.post('/webhook', paymentController.webhook);

module.exports = router;
