const pool = require('../config/db');

// Send a message about a listing (used for both starting a conversation and replying)
exports.sendMessage = async (req, res) => {
  try {
    const { listingId, receiverId, message } = req.body;
    if (!listingId || !receiverId || !message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Listing, receiver, and message text are required.' });
    }
    if (parseInt(receiverId, 10) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot message yourself.' });
    }

    await pool.query(
      'INSERT INTO messages (listing_id, sender_id, receiver_id, message) VALUES (?, ?, ?, ?)',
      [listingId, req.user.id, receiverId, message.trim()]
    );
    res.status(201).json({ success: true, message: 'Message sent successfully.' });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, message: 'Server error sending message.' });
  }
};

// Legacy inbox: flat list of messages received (kept for backward compatibility)
exports.getInbox = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.*, l.title AS listing_title, u.full_name AS sender_name, u.email AS sender_email
       FROM messages m
       JOIN listings l ON m.listing_id = l.id
       JOIN users u ON m.sender_id = u.id
       WHERE m.receiver_id = ?
       ORDER BY m.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, messages: rows });
  } catch (err) {
    console.error('Get inbox error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching inbox.' });
  }
};

// Conversation list: one row per (listing, other participant), showing the
// most recent message and how many are unread — like a typical inbox view.
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await pool.query(
      `SELECT t.* FROM (
         SELECT m.id, m.listing_id, m.message, m.created_at, m.is_read, m.sender_id, m.receiver_id,
                CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AS other_user_id,
                ROW_NUMBER() OVER (
                  PARTITION BY m.listing_id, CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
                  ORDER BY m.created_at DESC
                ) AS rn
         FROM messages m
         WHERE m.sender_id = ? OR m.receiver_id = ?
       ) t
       WHERE t.rn = 1
       ORDER BY t.created_at DESC`,
      [userId, userId, userId, userId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, conversations: [] });
    }

    // Enrich with listing title and other participant's name/email, plus unread counts
    const conversations = [];
    for (const row of rows) {
      const [[listing]] = await pool.query('SELECT title FROM listings WHERE id = ?', [row.listing_id]);
      const [[otherUser]] = await pool.query('SELECT full_name, email FROM users WHERE id = ?', [row.other_user_id]);
      const [[unread]] = await pool.query(
        'SELECT COUNT(*) AS cnt FROM messages WHERE listing_id = ? AND sender_id = ? AND receiver_id = ? AND is_read = FALSE',
        [row.listing_id, row.other_user_id, userId]
      );

      conversations.push({
        listingId: row.listing_id,
        listingTitle: listing ? listing.title : '(listing removed)',
        otherUserId: row.other_user_id,
        otherUserName: otherUser ? otherUser.full_name : 'Unknown user',
        otherUserEmail: otherUser ? otherUser.email : '',
        lastMessage: row.message,
        lastMessageAt: row.created_at,
        lastMessageFromMe: row.sender_id === userId,
        unreadCount: unread.cnt
      });
    }

    res.json({ success: true, conversations });
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching conversations.' });
  }
};

// Full thread of messages between the current user and one other user about one listing.
// Also marks the other person's messages as read.
exports.getThread = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listingId, otherUserId } = req.params;

    const [messages] = await pool.query(
      `SELECT m.*, u.full_name AS sender_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.listing_id = ?
         AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
       ORDER BY m.created_at ASC`,
      [listingId, userId, otherUserId, otherUserId, userId]
    );

    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE listing_id = ? AND sender_id = ? AND receiver_id = ?',
      [listingId, otherUserId, userId]
    );

    const [[listing]] = await pool.query('SELECT title FROM listings WHERE id = ?', [listingId]);

    res.json({ success: true, messages, listingTitle: listing ? listing.title : '(listing removed)' });
  } catch (err) {
    console.error('Get thread error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching conversation.' });
  }
};
