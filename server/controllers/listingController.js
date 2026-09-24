const pool = require('../config/db');

// Public: get all approved listings, with optional filters
exports.getListings = async (req, res) => {
  try {
    const { type, category, subcategory, search, sort } = req.query;

    let query = `
      SELECT l.*, u.full_name AS seller_name, u.email AS seller_email, u.phone AS seller_phone,
             c.name AS category_name, sc.name AS subcategory_name
      FROM listings l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN categories c ON l.category_id = c.id
      LEFT JOIN subcategories sc ON l.subcategory_id = sc.id
      WHERE l.status = 'approved'
    `;
    const params = [];

    if (type && (type === 'good' || type === 'service')) {
      query += ' AND l.listing_type = ?';
      params.push(type);
    }

    if (category) {
      query += ' AND l.category_id = ?';
      params.push(category);
    }

    if (subcategory) {
      query += ' AND l.subcategory_id = ?';
      params.push(subcategory);
    }

    if (search) {
      query += ' AND (l.title LIKE ? OR l.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (sort === 'price_asc') {
      query += ' ORDER BY l.price ASC';
    } else if (sort === 'price_desc') {
      query += ' ORDER BY l.price DESC';
    } else {
      query += ' ORDER BY l.created_at DESC';
    }

    const [rows] = await pool.query(query, params);
    res.json({ success: true, listings: rows });
  } catch (err) {
    console.error('Get listings error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching listings.' });
  }
};

exports.getListingById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT l.*, u.full_name AS seller_name, u.email AS seller_email, u.phone AS seller_phone,
              u.seller_bio AS seller_bio, c.name AS category_name, sc.name AS subcategory_name
       FROM listings l
       JOIN users u ON l.user_id = u.id
       LEFT JOIN categories c ON l.category_id = c.id
       LEFT JOIN subcategories sc ON l.subcategory_id = sc.id
       WHERE l.id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }
    await pool.query('UPDATE listings SET views = views + 1 WHERE id = ?', [id]);

    const [images] = await pool.query(
      'SELECT image_path FROM listing_images WHERE listing_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );

    const [[ratingSummary]] = await pool.query(
      'SELECT COUNT(*) AS reviewCount, AVG(rating) AS avgRating FROM reviews WHERE seller_id = ?',
      [rows[0].user_id]
    );

    const listing = {
      ...rows[0],
      images: images.map((r) => r.image_path),
      sellerRating: {
        count: ratingSummary.reviewCount,
        average: ratingSummary.avgRating ? Math.round(ratingSummary.avgRating * 10) / 10 : null
      }
    };

    res.json({ success: true, listing });
  } catch (err) {
    console.error('Get listing error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching listing.' });
  }
};

// Authenticated: get current user's own listings (any status)
exports.getMyListings = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*, c.name AS category_name, sc.name AS subcategory_name
       FROM listings l
       LEFT JOIN categories c ON l.category_id = c.id
       LEFT JOIN subcategories sc ON l.subcategory_id = sc.id
       WHERE l.user_id = ?
       ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, listings: rows });
  } catch (err) {
    console.error('Get my listings error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching your listings.' });
  }
};

// Authenticated: create a new listing (goes to pending until admin approves)
exports.createListing = async (req, res) => {
  try {
    const { title, description, price, listingType, categoryId, subcategoryId, condition, location, quantity } = req.body;

    if (!title || !price || !listingType) {
      return res.status(400).json({ success: false, message: 'Title, price, and listing type are required.' });
    }

    const [[user]] = await pool.query('SELECT is_seller FROM users WHERE id = ?', [req.user.id]);
    if (!user || !user.is_seller) {
      return res.status(403).json({
        success: false,
        message: 'Please complete your seller profile before creating a listing.',
        requiresSellerProfile: true
      });
    }

    const validConditions = ['brand_new', 'used', 'n_a'];
    const conditionValue = validConditions.includes(condition) ? condition : 'n_a';

    const parsedQuantity = parseInt(quantity, 10);
    const quantityValue = Number.isInteger(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : 1;

    const files = req.files || [];
    const imagePaths = files.map((f) => `/uploads/${f.filename}`);
    const primaryImage = imagePaths.length > 0 ? imagePaths[0] : null;

    const [result] = await pool.query(
      `INSERT INTO listings
        (user_id, category_id, subcategory_id, listing_type, title, description, price, quantity, condition_type, location, image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        req.user.id,
        categoryId || null,
        subcategoryId || null,
        listingType === 'service' ? 'service' : 'good',
        title.trim(),
        description || '',
        parseFloat(price),
        quantityValue,
        conditionValue,
        location || null,
        primaryImage
      ]
    );

    const listingId = result.insertId;

    if (imagePaths.length > 0) {
      const values = imagePaths.map((path, index) => [listingId, path, index]);
      await pool.query('INSERT INTO listing_images (listing_id, image_path, sort_order) VALUES ?', [values]);
    }

    res.status(201).json({
      success: true,
      message: 'Listing submitted! It will appear publicly once approved by an admin.',
      listingId
    });
  } catch (err) {
    console.error('Create listing error:', err);
    res.status(500).json({ success: false, message: 'Server error creating listing.' });
  }
};

// Authenticated: update own listing
exports.updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM listings WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You can only edit your own listings.' });
    }

    const { title, description, price, categoryId, subcategoryId, condition, location, status, quantity } = req.body;
    const validConditions = ['brand_new', 'used', 'n_a'];
    const conditionValue = condition && validConditions.includes(condition) ? condition : rows[0].condition_type;

    const parsedQuantity = parseInt(quantity, 10);
    const quantityValue = Number.isInteger(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : rows[0].quantity;

    const files = req.files || [];
    const newImagePaths = files.map((f) => `/uploads/${f.filename}`);
    const replacingImages = newImagePaths.length > 0;
    const image = replacingImages ? newImagePaths[0] : rows[0].image;

    // Non-admins editing content resets status back to pending for re-review
    let newStatus = rows[0].status;
    if (req.user.role === 'admin' && status) {
      newStatus = status;
    } else if (req.user.role !== 'admin') {
      newStatus = 'pending';
    }

    await pool.query(
      `UPDATE listings SET title = ?, description = ?, price = ?, quantity = ?, category_id = ?, subcategory_id = ?,
       condition_type = ?, location = ?, image = ?, status = ? WHERE id = ?`,
      [
        title || rows[0].title,
        description !== undefined ? description : rows[0].description,
        price ? parseFloat(price) : rows[0].price,
        quantityValue,
        categoryId || rows[0].category_id,
        subcategoryId !== undefined ? (subcategoryId || null) : rows[0].subcategory_id,
        conditionValue,
        location !== undefined ? location : rows[0].location,
        image,
        newStatus,
        id
      ]
    );

    // If new photos were uploaded, replace the whole gallery with them
    if (replacingImages) {
      await pool.query('DELETE FROM listing_images WHERE listing_id = ?', [id]);
      const values = newImagePaths.map((path, index) => [id, path, index]);
      await pool.query('INSERT INTO listing_images (listing_id, image_path, sort_order) VALUES ?', [values]);
    }

    res.json({ success: true, message: 'Listing updated successfully.' });
  } catch (err) {
    console.error('Update listing error:', err);
    res.status(500).json({ success: false, message: 'Server error updating listing.' });
  }
};

// Authenticated: delete own listing (or admin deletes any)
exports.deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM listings WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You can only delete your own listings.' });
    }
    await pool.query('DELETE FROM listings WHERE id = ?', [id]);
    res.json({ success: true, message: 'Listing deleted successfully.' });
  } catch (err) {
    console.error('Delete listing error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting listing.' });
  }
};

// Authenticated: mark own listing as sold
exports.markAsSold = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM listings WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    await pool.query('UPDATE listings SET status = ? WHERE id = ?', ['sold', id]);
    res.json({ success: true, message: 'Listing marked as sold.' });
  } catch (err) {
    console.error('Mark as sold error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

exports.getCategories = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY name ASC');
    res.json({ success: true, categories: rows });
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching categories.' });
  }
};

exports.getSubcategories = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const [rows] = await pool.query(
      'SELECT * FROM subcategories WHERE category_id = ? ORDER BY name ASC',
      [categoryId]
    );
    res.json({ success: true, subcategories: rows });
  } catch (err) {
    console.error('Get subcategories error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching subcategories.' });
  }
};
