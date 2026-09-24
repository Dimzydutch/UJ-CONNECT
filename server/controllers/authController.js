const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const pool = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
require('dotenv').config();

const SCHOOL_DOMAIN = (process.env.SCHOOL_EMAIL_DOMAIN || 'unijos.edu.ng').toLowerCase();

function isSchoolEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const lower = email.toLowerCase().trim();
  return lower.endsWith('@' + SCHOOL_DOMAIN) || lower.endsWith('.' + SCHOOL_DOMAIN);
}

// ---------- 2FA helpers ----------

// Generates human-friendly one-time backup codes, e.g. "A1B2C-D3E4F"
function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

// Checks a submitted code against a user's hashed backup codes.
// If it matches, that code is consumed (removed) so it can't be reused.
async function tryConsumeBackupCode(dbUser, submittedCode) {
  if (!dbUser.two_factor_backup_codes) return false;
  let hashes;
  try {
    hashes = JSON.parse(dbUser.two_factor_backup_codes);
  } catch (e) {
    return false;
  }
  if (!Array.isArray(hashes) || hashes.length === 0) return false;

  for (let i = 0; i < hashes.length; i++) {
    const match = await bcrypt.compare(submittedCode, hashes[i]);
    if (match) {
      hashes.splice(i, 1);
      await pool.query('UPDATE users SET two_factor_backup_codes = ? WHERE id = ?', [
        JSON.stringify(hashes),
        dbUser.id
      ]);
      return true;
    }
  }
  return false;
}

// Verifies a 6-digit TOTP code, falling back to backup codes.
async function verifyTotpOrBackup(dbUser, submittedCode, secret) {
  const cleanCode = (submittedCode || '').toString().trim().replace(/\s+/g, '');
  if (!cleanCode) return false;

  const totpValid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: cleanCode,
    window: 1 // allows codes from ~30s before/after for clock drift
  });
  if (totpValid) return true;

  return tryConsumeBackupCode(dbUser, cleanCode);
}

exports.signup = async (req, res) => {
  try {
    const { fullName, email, password, studentNumber, phone } = req.body;

    if (!fullName || !email || !password || !phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'Full name, email, password, and phone number are required.' });
    }

    const cleanPhone = phone.trim();
    if (cleanPhone.length < 7) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    if (!isSchoolEmail(email)) {
      return res.status(400).json({
        success: false,
        message: `Please sign up using a valid school email address (must end with @${SCHOOL_DOMAIN}).`
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, password, student_number, phone, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fullName.trim(), email.toLowerCase().trim(), hashedPassword, studentNumber || null, cleanPhone, 'student', 'active']
    );

    const user = {
      id: result.insertId,
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      role: 'student'
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Account created successfully. Welcome to UJ Connect!',
      token,
      user
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ success: false, message: 'Server error during signup.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const dbUser = rows[0];

    if (dbUser.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact admin support.' });
    }

    const match = await bcrypt.compare(password, dbUser.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // If 2FA is enabled, don't issue a full session yet — issue a short-lived
    // "pending" token that only /auth/verify-2fa will accept.
    if (dbUser.two_factor_enabled) {
      const pendingToken = jwt.sign(
        { id: dbUser.id, type: 'pending2fa' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({
        success: true,
        requires2FA: true,
        tempToken: pendingToken,
        message: 'Enter the 6-digit code from your authenticator app.'
      });
    }

    const user = {
      id: dbUser.id,
      fullName: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role
    };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Login successful.',
      token,
      user
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// Step 2 of login when 2FA is enabled: exchange tempToken + code for a full session
exports.verify2FA = async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ success: false, message: 'Verification code is required.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Your session expired. Please log in again.' });
    }
    if (decoded.type !== 'pending2fa') {
      return res.status(400).json({ success: false, message: 'Invalid verification request.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const dbUser = rows[0];

    if (!dbUser.two_factor_enabled) {
      return res.status(400).json({ success: false, message: 'Two-factor authentication is not enabled on this account.' });
    }
    if (dbUser.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact admin support.' });
    }

    const verified = await verifyTotpOrBackup(dbUser, code, dbUser.two_factor_secret);
    if (!verified) {
      return res.status(401).json({ success: false, message: 'Invalid or expired code. Please try again.' });
    }

    const user = {
      id: dbUser.id,
      fullName: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role
    };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, message: 'Login successful.', token, user });
  } catch (err) {
    console.error('2FA verification error:', err);
    res.status(500).json({ success: false, message: 'Server error during 2FA verification.' });
  }
};

// Get current 2FA status for the logged-in user
exports.get2FAStatus = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT two_factor_enabled FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, enabled: !!rows[0].two_factor_enabled });
  } catch (err) {
    console.error('Get 2FA status error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching 2FA status.' });
  }
};

// Start 2FA setup: generate a secret + QR code (not enabled until confirmed)
exports.setup2FA = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const dbUser = rows[0];

    if (dbUser.two_factor_enabled) {
      return res.status(400).json({ success: false, message: 'Two-factor authentication is already enabled on your account.' });
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `UJ Connect (${dbUser.email})`,
      issuer: 'UJ Connect'
    });

    await pool.query('UPDATE users SET two_factor_temp_secret = ? WHERE id = ?', [secret.base32, dbUser.id]);

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeDataUrl,
      message: 'Scan the QR code with your authenticator app, then confirm with a code to finish setup.'
    });
  } catch (err) {
    console.error('2FA setup error:', err);
    res.status(500).json({ success: false, message: 'Server error starting 2FA setup.' });
  }
};

// Confirm setup: verify the first code and permanently enable 2FA
exports.enable2FA = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Verification code is required.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const dbUser = rows[0];

    if (!dbUser.two_factor_temp_secret) {
      return res.status(400).json({ success: false, message: 'Please start 2FA setup first.' });
    }

    const cleanCode = code.toString().trim().replace(/\s+/g, '');
    const verified = speakeasy.totp.verify({
      secret: dbUser.two_factor_temp_secret,
      encoding: 'base32',
      token: cleanCode,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ success: false, message: 'Invalid code. Please check your authenticator app and try again.' });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await pool.query(
      `UPDATE users
       SET two_factor_enabled = TRUE, two_factor_secret = ?, two_factor_temp_secret = NULL, two_factor_backup_codes = ?
       WHERE id = ?`,
      [dbUser.two_factor_temp_secret, JSON.stringify(hashedCodes), dbUser.id]
    );

    res.json({
      success: true,
      message: 'Two-factor authentication is now enabled! Save your backup codes somewhere safe.',
      backupCodes
    });
  } catch (err) {
    console.error('2FA enable error:', err);
    res.status(500).json({ success: false, message: 'Server error enabling 2FA.' });
  }
};

// Disable 2FA — requires current password + a valid code (TOTP or backup)
exports.disable2FA = async (req, res) => {
  try {
    const { password, code } = req.body;
    if (!password || !code) {
      return res.status(400).json({ success: false, message: 'Password and verification code are required.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const dbUser = rows[0];

    if (!dbUser.two_factor_enabled) {
      return res.status(400).json({ success: false, message: 'Two-factor authentication is not enabled on your account.' });
    }

    const passwordMatch = await bcrypt.compare(password, dbUser.password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    const verified = await verifyTotpOrBackup(dbUser, code, dbUser.two_factor_secret);
    if (!verified) {
      return res.status(401).json({ success: false, message: 'Invalid verification code.' });
    }

    await pool.query(
      `UPDATE users
       SET two_factor_enabled = FALSE, two_factor_secret = NULL, two_factor_temp_secret = NULL, two_factor_backup_codes = NULL
       WHERE id = ?`,
      [dbUser.id]
    );

    res.json({ success: true, message: 'Two-factor authentication has been disabled.' });
  } catch (err) {
    console.error('2FA disable error:', err);
    res.status(500).json({ success: false, message: 'Server error disabling 2FA.' });
  }
};

// Regenerate backup codes (invalidates old ones) — requires a valid current code
exports.regenerateBackupCodes = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Verification code is required.' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const dbUser = rows[0];

    if (!dbUser.two_factor_enabled) {
      return res.status(400).json({ success: false, message: 'Two-factor authentication is not enabled on your account.' });
    }

    const cleanCode = code.toString().trim().replace(/\s+/g, '');
    const verified = speakeasy.totp.verify({
      secret: dbUser.two_factor_secret,
      encoding: 'base32',
      token: cleanCode,
      window: 1
    });
    if (!verified) {
      return res.status(401).json({ success: false, message: 'Invalid verification code.' });
    }

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

    await pool.query('UPDATE users SET two_factor_backup_codes = ? WHERE id = ?', [
      JSON.stringify(hashedCodes),
      dbUser.id
    ]);

    res.json({ success: true, message: 'New backup codes generated. Your old codes no longer work.', backupCodes });
  } catch (err) {
    console.error('Regenerate backup codes error:', err);
    res.status(500).json({ success: false, message: 'Server error regenerating backup codes.' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, email, student_number, phone, role, status, avatar, is_seller, seller_bio, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// Authenticated: set up or update the current user's seller profile
// (description of what they sell + a public contact phone number)
exports.updateSellerProfile = async (req, res) => {
  try {
    const { sellerBio, phone } = req.body;

    if (!sellerBio || !sellerBio.trim()) {
      return res.status(400).json({ success: false, message: 'Please describe what you sell.' });
    }
    if (!phone || phone.trim().length < 7) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    await pool.query(
      'UPDATE users SET is_seller = TRUE, seller_bio = ?, phone = ? WHERE id = ?',
      [sellerBio.trim(), phone.trim(), req.user.id]
    );

    res.json({ success: true, message: 'Seller profile saved!' });
  } catch (err) {
    console.error('Update seller profile error:', err);
    res.status(500).json({ success: false, message: 'Server error saving seller profile.' });
  }
};

exports.isSchoolEmail = isSchoolEmail;
