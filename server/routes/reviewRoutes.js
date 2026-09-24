const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { verifyToken } = require('../middleware/auth');

router.post('/', verifyToken, reviewController.createReview);
router.get('/seller/:sellerId', reviewController.getSellerReviews);
router.get('/status/:listingId', verifyToken, reviewController.getMyReviewStatus);

module.exports = router;
