const pool = require('../config/db');
const bcrypt = require('bcryptjs');

exports.getDashboardStats = async (req, res) => {
  try {
    const [[userCount]] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE role = "student"');
    const [[listingCount]] = await pool.query('SELECT COUNT(*) AS count FROM listings');
    const [[pendingCount]] = await pool.query('SELECT COUNT(*) AS count FROM listings WHERE status = "pending"');
    const [[approvedCount]] = await pool.query('SELECT COUNT(*) AS count FROM listings WHERE status = "approved"');
    const [[soldCount]] = await pool.query('SELECT COUNT(*) AS count FROM listings WHERE status = "sold"');
    const [[goodsCount]] = await pool.query('SELECT COUNT(*) AS count FROM listings WHERE listing_type = "good"');
    const [[servicesCount]] = await pool.query('SELECT COUNT(*) AS count FROM listings WHERE listing_type = "service"');
    const [[reportCount]] = await pool.query('SELECT COUNT(*) AS count FROM reports WHERE status = "open"');

    const [recentListings] = await pool.query(
      `SELECT l.id, l.title, l.status, l.listing_type, l.price, l.created_at, u.full_name AS seller_name
       FROM listings l JOIN users u ON l.user_id = u.id
       ORDER BY l.created_at DESC LIMIT 5`
    );

    const [recentUsers] = await pool.query(
      `SELECT id, full_name, email, created_at FROM users WHERE role = "student"
       ORDER BY created_at DESC LIMIT 5`
    );

    res.json({
      success: true,
      stats: {
        totalUsers: userCount.count,
        totalListings: listingCount.count,
        pendingListings: pendingCount.count,
        approvedListings: approvedCount.count,
        soldListings: soldCount.count,
        goodsCount: goodsCount.count,
        servicesCount: servicesCount.count,
        openReports: reportCount.count
      },
      recentListings,
      recentUsers
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching dashboard stats.' });
  }
};

exports.getAllListings = async (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT l.*, u.full_name AS seller_name, u.email AS seller_email, c.name AS category_name
      FROM listings l
      JOIN users u ON l.user_id = u.id
      LEFT JOIN categories c ON l.category_id = c.id
    `;
    const params = [];
    if (status) {
      query += ' WHERE l.status = ?';
      params.push(status);
    }
    query += ' ORDER BY l.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, listings: rows });
  } catch (err) {
    console.error('Admin get listings error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching listings.' });
  }
};

exports.updateListingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['pending', 'approved', 'rejected', 'sold'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }
    const [result] = await pool.query('UPDATE listings SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Listing not found.' });
    }
    res.json({ success: true, message: `Listing status updated to ${status}.` });
  } catch (err) {
    console.error('Update listing status error:', err);
    res.status(500).json({ success: false, message: 'Server error updating listing status.' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name, email, student_number, phone, role, status, is_seller, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    console.error('Get all users error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching users.' });
  }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot change your own status.' });
    }
    const [result] = await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, message: `User status updated to ${status}.` });
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ success: false, message: 'Server error updating user.' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting user.' });
  }
};

exports.createCategory = async (req, res) => {
  try {
    const { name, type, icon } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }
    const validType = ['goods', 'services'].includes(type) ? type : 'goods';
    const [result] = await pool.query(
      'INSERT INTO categories (name, type, icon) VALUES (?, ?, ?)',
      [name.trim(), validType, icon || 'tag']
    );
    res.status(201).json({ success: true, message: 'Category created.', categoryId: result.insertId });
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ success: false, message: 'Server error creating category.' });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Category deleted.' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting category.' });
  }
};

exports.createSubcategory = async (req, res) => {
  try {
    const { categoryId, name } = req.body;
    if (!categoryId || !name) {
      return res.status(400).json({ success: false, message: 'Main category and subcategory name are required.' });
    }
    const [result] = await pool.query(
      'INSERT INTO subcategories (category_id, name) VALUES (?, ?)',
      [categoryId, name.trim()]
    );
    res.status(201).json({ success: true, message: 'Subcategory created.', subcategoryId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'That subcategory already exists under this category.' });
    }
    console.error('Create subcategory error:', err);
    res.status(500).json({ success: false, message: 'Server error creating subcategory.' });
  }
};

exports.deleteSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM subcategories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Subcategory deleted.' });
  } catch (err) {
    console.error('Delete subcategory error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting subcategory.' });
  }
};

exports.getAllReports = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, l.title AS listing_title, u.full_name AS reporter_name
       FROM reports r
       JOIN listings l ON r.listing_id = l.id
       JOIN users u ON r.reporter_id = u.id
       ORDER BY r.created_at DESC`
    );
    res.json({ success: true, reports: rows });
  } catch (err) {
    console.error('Get reports error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching reports.' });
  }
};

exports.resolveReport = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE reports SET status = "resolved" WHERE id = ?', [id]);
    res.json({ success: true, message: 'Report marked as resolved.' });
  } catch (err) {
    console.error('Resolve report error:', err);
    res.status(500).json({ success: false, message: 'Server error resolving report.' });
  }
};
