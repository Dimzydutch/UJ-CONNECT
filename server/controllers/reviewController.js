const pool = require('../config/db');

// Authenticated: leave a review for a seller, tied to a specific listing
exports.createReview = async (req, res) => {
  try {
    const { listingId, rating, comment } = req.body;

    if (!listingId || !rating) {
      return res.status(400).json({ success: false, message: 'Listing and rating are required.' });
    }

    const numericRating = parseInt(rating, 10);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5.' });
    }

    const [listingRows] = await pool.query('SELECT id, user_id FROM listings WHERE id = ?', [listingId]);
    if (listingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }
    const sellerId = listingRows[0].user_id;

    if (sellerId === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot review your own listing.' });
    }

    try {
      await pool.query(
        'INSERT INTO reviews (listing_id, seller_id, reviewer_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
        [listingId, sellerId, req.user.id, numericRating, (comment || '').trim()]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'You have already reviewed this listing.' });
      }
      throw err;
    }

    res.status(201).json({ success: true, message: 'Thanks! Your review has been posted.' });
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ success: false, message: 'Server error submitting review.' });
  }
};

// Public: all reviews for a seller, plus the average rating and count
exports.getSellerReviews = async (req, res) => {
  try {
    const { sellerId } = req.params;

    const [reviews] = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, r.listing_id,
              u.full_name AS reviewer_name, l.title AS listing_title
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       JOIN listings l ON r.listing_id = l.id
       WHERE r.seller_id = ?
       ORDER BY r.created_at DESC`,
      [sellerId]
    );

    const [[summary]] = await pool.query(
      'SELECT COUNT(*) AS reviewCount, AVG(rating) AS avgRating FROM reviews WHERE seller_id = ?',
      [sellerId]
    );

    res.json({
      success: true,
      reviews,
      summary: {
        count: summary.reviewCount,
        average: summary.avgRating ? Math.round(summary.avgRating * 10) / 10 : null
      }
    });
  } catch (err) {
    console.error('Get seller reviews error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching reviews.' });
  }
};

// Authenticated: check whether the current user can/has review a given listing
// (used by the frontend to decide whether to show the review form)
exports.getMyReviewStatus = async (req, res) => {
  try {
    const { listingId } = req.params;
    const [rows] = await pool.query(
      'SELECT id FROM reviews WHERE listing_id = ? AND reviewer_id = ?',
      [listingId, req.user.id]
    );
    res.json({ success: true, hasReviewed: rows.length > 0 });
  } catch (err) {
    console.error('Get review status error:', err);
    res.status(500).json({ success: false, message: 'Server error checking review status.' });
  }
};
