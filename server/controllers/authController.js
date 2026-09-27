const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const pool = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');
const { generateOtp, hashOtp, verifyOtp } = require('../utils/otp');
const { sendOtpEmail } = require('../config/mailer');
require('dotenv').config();

const SCHOOL_DOMAIN = (process.env.SCHOOL_EMAIL_DOMAIN || 'unijos.edu.ng').toLowerCase();

// ---------- Email OTP (registration verification) settings ----------
const OTP_EXPIRY_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegistrationInput({ fullName, email, password, studentNumber, phone }) {
  const cleanStudentNumber = (studentNumber || '').trim();
  if (!fullName || !fullName.trim() || !email || !password || !phone || !phone.trim() || !cleanStudentNumber) {
    return {
      valid: false,
      message: 'Full name, email, password, student mat number, and phone number are required.'
    };
  }

  const cleanName = fullName.trim();
  const cleanEmail = String(email).toLowerCase().trim();
  const cleanPhone = phone.trim();

  if (!EMAIL_FORMAT_REGEX.test(cleanEmail)) {
    return { valid: false, message: 'Please enter a valid email address.' };
  }

  if (!isSchoolEmail(cleanEmail)) {
    return {
      valid: false,
      message: `Please sign up using a valid school email address (must end with @${SCHOOL_DOMAIN}).`
    };
  }

  if (cleanPhone.length < 7) {
    return { valid: false, message: 'Please enter a valid phone number.' };
  }

  if (typeof password !== 'string' || password.length < 6) {
    return { valid: false, message: 'Password must be at least 6 characters.' };
  }

  return {
    valid: true,
    message: '',
    cleanName,
    cleanEmail,
    cleanPhone,
    cleanStudentNumber
  };
}

function isSchoolEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const lower = email.toLowerCase().trim();
  return lower.endsWith('@' + SCHOOL_DOMAIN) || lower.endsWith('.' + SCHOOL_DOMAIN);
}

// ---------- 2FA helpers ----------

function normalizeTwoFactorCode(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, '').replace(/-/g, '');
}

function isValidTwoFactorCode(value) {
  return /^\d{6}$/.test(normalizeTwoFactorCode(value));
}

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

// ---------------------------------------------------------------------------
// STEP 1: Register + send a 6-digit email verification code.
// Creates (or, if a matching *unverified* signup already exists, updates) an
// unverified user row, then emails a fresh OTP. The account only becomes
// usable once verifyRegistrationOtp succeeds.
// ---------------------------------------------------------------------------
exports.validateRegistrationInput = validateRegistrationInput;
exports.normalizeTwoFactorCode = normalizeTwoFactorCode;
exports.isValidTwoFactorCode = isValidTwoFactorCode;

exports.sendRegistrationOtp = async (req, res) => {
  const conn = await pool.getConnection();
  let transactionOpen = false;

  try {
    const { fullName, email, password, studentNumber, phone } = req.body;

    const validation = validateRegistrationInput({ fullName, email, password, studentNumber, phone });

    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const { cleanName, cleanEmail, cleanPhone, cleanStudentNumber } = validation;

    await conn.beginTransaction();
    transactionOpen = true;

    // Lock any existing row for this email so two concurrent requests can't race.
    const [existingRows] = await conn.query('SELECT id, is_verified FROM users WHERE email = ? FOR UPDATE', [cleanEmail]);

    let userId;
    if (existingRows.length > 0) {
      const existing = existingRows[0];
      if (existing.is_verified) {
        await conn.rollback();
        return res.status(409).json({ success: false, message: 'An account with this email already exists. Please log in instead.' });
      }
      // Unverified account already pending from a previous attempt — refresh
      // their details/password and we'll send them a new code below.
      const hashedPassword = await bcrypt.hash(password, 10);
      await conn.query(
        'UPDATE users SET full_name = ?, password = ?, student_number = ?, phone = ? WHERE id = ?',
        [cleanName, hashedPassword, cleanStudentNumber, cleanPhone, existing.id]
      );
      userId = existing.id;
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      try {
        const [result] = await conn.query(
          'INSERT INTO users (full_name, email, password, student_number, phone, role, status, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [cleanName, cleanEmail, hashedPassword, cleanStudentNumber, cleanPhone, 'student', 'active', false]
        );
        userId = result.insertId;
      } catch (insertErr) {
        // Handles the rare race where two requests for the same new email land at once.
        if (insertErr.code === 'ER_DUP_ENTRY') {
          await conn.rollback();
          return res.status(409).json({ success: false, message: 'An account with this email already exists. Please log in instead.' });
        }
        throw insertErr;
      }
    }

    // ---- Resend cooldown: block spamming a fresh code every few seconds ----
    const [recentOtp] = await conn.query(
      `SELECT created_at FROM email_otps WHERE user_id = ? AND purpose = 'email_verification'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (recentOtp.length > 0) {
      const secondsSinceLast = (Date.now() - new Date(recentOtp[0].created_at).getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        await conn.rollback();
        return res.status(429).json({
          success: false,
          message: `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast)}s before requesting another code.`
        });
      }
    }

    // Invalidate any previous codes so only the newest one can ever be used.
    await conn.query(`DELETE FROM email_otps WHERE user_id = ? AND purpose = 'email_verification'`, [userId]);

    const code = generateOtp();
    const codeHash = hashOtp(code, cleanEmail);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await conn.query(
      `INSERT INTO email_otps (user_id, email, code_hash, purpose, attempts, max_attempts, expires_at)
       VALUES (?, ?, ?, 'email_verification', 0, ?, ?)`,
      [userId, cleanEmail, codeHash, OTP_MAX_ATTEMPTS, expiresAt]
    );

    await conn.commit();
    transactionOpen = false;

    // Send the email outside the transaction so a slow mail provider never
    // holds a DB lock/connection open.
    try {
      await sendOtpEmail(cleanEmail, cleanName, code);
    } catch (mailErr) {
      console.error('Failed to send OTP email:', mailErr);
      return res.status(502).json({ success: false, message: 'Could not send the verification email. Please try again shortly.' });
    }

    res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been sent to ${cleanEmail}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      email: cleanEmail
    });
  } catch (err) {
    if (transactionOpen) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
    }
    console.error('Send registration OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error while sending verification code.' });
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// STEP 2: Verify the 6-digit code, mark the account verified, and issue a JWT.
// ---------------------------------------------------------------------------
exports.verifyRegistrationOtp = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanCode = String(code).trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({ success: false, message: 'The verification code must be 6 digits.' });
    }

    const [userRows] = await pool.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'No pending registration found for this email.' });
    }
    const dbUser = userRows[0];

    if (dbUser.is_verified) {
      return res.status(400).json({ success: false, message: 'This email is already verified. Please log in.' });
    }

    const [otpRows] = await pool.query(
      `SELECT * FROM email_otps WHERE user_id = ? AND purpose = 'email_verification'
       ORDER BY created_at DESC LIMIT 1`,
      [dbUser.id]
    );
    if (otpRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No verification code found. Please request a new one.' });
    }
    const otpRow = otpRows[0];

    if (otpRow.consumed_at) {
      return res.status(400).json({ success: false, message: 'This code has already been used. Please request a new one.' });
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'This code has expired. Please request a new one.' });
    }
    if (otpRow.attempts >= otpRow.max_attempts) {
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new code.' });
    }

    const isValid = verifyOtp(cleanCode, cleanEmail, otpRow.code_hash);

    if (!isValid) {
      const attemptsLeft = otpRow.max_attempts - (otpRow.attempts + 1);
      await pool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?', [otpRow.id]);
      return res.status(401).json({
        success: false,
        message: attemptsLeft > 0
          ? `Incorrect code. ${attemptsLeft} attempt(s) remaining.`
          : 'Incorrect code. No attempts remaining — please request a new code.'
      });
    }

    // Success: mark the account verified and consume the code so it can't be reused.
    await pool.query('UPDATE users SET is_verified = TRUE WHERE id = ?', [dbUser.id]);
    await pool.query('UPDATE email_otps SET consumed_at = NOW() WHERE id = ?', [otpRow.id]);

    const user = {
      id: dbUser.id,
      fullName: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role
    };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Email verified successfully. Welcome to UJ Connect!',
      token,
      user
    });
  } catch (err) {
    console.error('Verify registration OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error while verifying code.' });
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

    if (!dbUser.is_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. Check your inbox for the 6-digit code.',
        requiresVerification: true,
        email: dbUser.email
      });
    }

    const match = await bcrypt.compare(password, dbUser.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // If 2FA is enabled via authenticator app, keep the existing flow.
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

    const loginCode = generateOtp();
    const codeHash = hashOtp(loginCode, dbUser.email);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await pool.query(`DELETE FROM email_otps WHERE user_id = ? AND purpose = 'login_verification'`, [dbUser.id]);
    await pool.query(
      `INSERT INTO email_otps (user_id, email, code_hash, purpose, attempts, max_attempts, expires_at)
       VALUES (?, ?, ?, 'login_verification', 0, ?, ?)`,
      [dbUser.id, dbUser.email, codeHash, OTP_MAX_ATTEMPTS, expiresAt]
    );

    try {
      await sendOtpEmail(dbUser.email, dbUser.full_name || 'User', loginCode);
    } catch (mailErr) {
      console.error('Failed to send login OTP email:', mailErr);
      return res.status(502).json({ success: false, message: 'Could not send the login code. Please try again shortly.' });
    }

    return res.json({
      success: true,
      requiresEmailOtp: true,
      email: dbUser.email,
      message: 'We sent a 6-digit code to your email to complete login.'
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

exports.verifyLoginOtp = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and verification code are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanCode = normalizeTwoFactorCode(code);

    if (!isValidTwoFactorCode(cleanCode)) {
      return res.status(400).json({ success: false, message: 'The verification code must be 6 digits.' });
    }

    const [userRows] = await pool.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const dbUser = userRows[0];
    if (dbUser.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended. Contact admin support.' });
    }

    const [otpRows] = await pool.query(
      `SELECT * FROM email_otps WHERE user_id = ? AND purpose = 'login_verification'
       ORDER BY created_at DESC LIMIT 1`,
      [dbUser.id]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No login code found. Please log in again.' });
    }

    const otpRow = otpRows[0];
    if (otpRow.consumed_at) {
      return res.status(400).json({ success: false, message: 'This code has already been used. Please log in again.' });
    }
    if (new Date(otpRow.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'This login code has expired. Please log in again.' });
    }
    if (otpRow.attempts >= otpRow.max_attempts) {
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please log in again.' });
    }

    const isValid = verifyOtp(cleanCode, cleanEmail, otpRow.code_hash);
    if (!isValid) {
      const attemptsLeft = otpRow.max_attempts - (otpRow.attempts + 1);
      await pool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = ?', [otpRow.id]);
      return res.status(401).json({
        success: false,
        message: attemptsLeft > 0
          ? `Incorrect code. ${attemptsLeft} attempt(s) remaining.`
          : 'Incorrect code. No attempts remaining — please log in again.'
      });
    }

    await pool.query('UPDATE email_otps SET consumed_at = NOW() WHERE id = ?', [otpRow.id]);

    const user = {
      id: dbUser.id,
      fullName: dbUser.full_name,
      email: dbUser.email,
      role: dbUser.role
    };
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user
    });
  } catch (err) {
    console.error('Verify login OTP error:', err);
    res.status(500).json({ success: false, message: 'Server error while verifying login code.' });
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
    const [[user]] = await pool.query('SELECT is_seller FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, message: 'User account not found.' });
    if (!user.is_seller) {
      return res.status(409).json({ success: false, message: 'Complete seller setup with a verified payout account first.' });
    }

    if (!sellerBio || !sellerBio.trim()) {
      return res.status(400).json({ success: false, message: 'Please add a short bio of what you sell.' });
    }
    if (!phone || phone.trim().length < 7) {
      return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    await pool.query(
      'UPDATE users SET seller_bio = ?, phone = ? WHERE id = ?',
      [sellerBio.trim(), phone.trim(), req.user.id]
    );

    res.json({ success: true, message: 'Seller profile saved!' });
  } catch (err) {
    console.error('Update seller profile error:', err);
    res.status(500).json({ success: false, message: 'Server error saving seller profile.' });
  }
};

exports.isSchoolEmail = isSchoolEmail;
