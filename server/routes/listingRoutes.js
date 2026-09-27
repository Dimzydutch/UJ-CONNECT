const express = require('express');
const router = express.Router();
const listingController = require('../controllers/listingController');
const { verifyToken } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Public
router.get('/', listingController.getListings);
router.get('/categories', listingController.getCategories);
router.get('/subcategories/:categoryId', listingController.getSubcategories);

// Authenticated (specific routes before /:id)
router.get('/mine', verifyToken, listingController.getMyListings);
router.post('/', verifyToken, upload.array('images', 5), listingController.createListing);

router.get('/:id', listingController.getListingById);
router.put('/:id', verifyToken, upload.array('images', 5), listingController.updateListing);
router.delete('/:id', verifyToken, listingController.deleteListing);
router.patch('/:id/sold', verifyToken, listingController.markAsSold);

module.exports = router;
