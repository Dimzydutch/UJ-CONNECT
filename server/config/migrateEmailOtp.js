/**
 * Migration: adds email-OTP verification support to an EXISTING database
 * that was created before this feature was introduced. Safe to run multiple
 * times — it checks before adding anything.
 *
 * Run with:
 *   npm run migrate-email-otp
 *
 * New installs don't need this — schema.sql already includes it.
 */
const pool = require('./db');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'uj_connect';

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  return rows[0].cnt > 0;
}

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB_NAME, table]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  console.log(`Checking "${DB_NAME}" for email-OTP verification support...`);

  // 1. users.is_verified
  const hasIsVerified = await columnExists('users', 'is_verified');
  if (hasIsVerified) {
    console.log('  - users.is_verified: already exists, skipping.');
  } else {
    await pool.query('ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE');
    console.log('  - users.is_verified: added.');

    // Treat everyone who already has an account (pre-OTP) as verified so
    // existing users aren't locked out after this migration runs.
    await pool.query('UPDATE users SET is_verified = TRUE');
    console.log('  - Existing users marked as verified (grandfathered in).');
  }

  // 2. email_otps table
  const hasOtpTable = await tableExists('email_otps');
  if (hasOtpTable) {
    console.log('  - email_otps table: already exists, skipping.');
  } else {
    await pool.query(`
      CREATE TABLE email_otps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(150) NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        purpose VARCHAR(30) NOT NULL DEFAULT 'email_verification',
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 3,
        expires_at DATETIME NOT NULL,
        consumed_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_email_otps_user_purpose (user_id, purpose)
      )
    `);
    console.log('  - email_otps table: created.');
  }

  console.log('Migration complete — your database now supports email OTP verification.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
