const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken } = require('../middleware/auth');

router.post('/', verifyToken, async (req, res) => {
  try {
    const { listingId, reason } = req.body;
    if (!listingId || !reason) {
      return res.status(400).json({ success: false, message: 'Listing ID and reason are required.' });
    }
    await pool.query(
      'INSERT INTO reports (listing_id, reporter_id, reason) VALUES (?, ?, ?)',
      [listingId, req.user.id, reason.trim()]
    );
    res.status(201).json({ success: true, message: 'Report submitted. Our admin team will review it.' });
  } catch (err) {
    console.error('Create report error:', err);
    res.status(500).json({ success: false, message: 'Server error submitting report.' });
  }
});

module.exports = router;
