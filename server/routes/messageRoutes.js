const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { verifyToken } = require('../middleware/auth');

router.post('/', verifyToken, messageController.sendMessage);
router.get('/inbox', verifyToken, messageController.getInbox);
router.get('/conversations', verifyToken, messageController.getConversations);
router.get('/thread/:listingId/:otherUserId', verifyToken, messageController.getThread);

module.exports = router;
