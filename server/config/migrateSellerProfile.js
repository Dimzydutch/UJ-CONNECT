/**
 * Migration: adds seller profile fields (is_seller, seller_bio) and makes
 * the phone column required, for an EXISTING database created before
 * these were added.
 *
 * Run with:
 *   npm run migrate-seller-profile
 *
 * IMPORTANT: any existing user with no phone number on file gets a
 * placeholder value ("Not provided") before the column is locked to
 * NOT NULL — you'll want to prompt those users to update it from their
 * account settings. Safe to run more than once.
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

async function isColumnNullable(table, column) {
  const [rows] = await pool.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  return rows.length > 0 && rows[0].IS_NULLABLE === 'YES';
}

async function migrate() {
  console.log(`Migrating "${DB_NAME}".users for seller profiles + required phone...`);

  const hasIsSeller = await columnExists('users', 'is_seller');
  if (hasIsSeller) {
    console.log('  - is_seller: already exists, skipping.');
  } else {
    await pool.query('ALTER TABLE users ADD COLUMN is_seller BOOLEAN NOT NULL DEFAULT FALSE');
    console.log('  - is_seller: added.');
  }

  const hasSellerBio = await columnExists('users', 'seller_bio');
  if (hasSellerBio) {
    console.log('  - seller_bio: already exists, skipping.');
  } else {
    await pool.query('ALTER TABLE users ADD COLUMN seller_bio TEXT DEFAULT NULL');
    console.log('  - seller_bio: added.');
  }

  const phoneNullable = await isColumnNullable('users', 'phone');
  if (!phoneNullable) {
    console.log('  - phone: already required, skipping.');
  } else {
    const [result] = await pool.query(
      `UPDATE users SET phone = 'Not provided' WHERE phone IS NULL OR phone = ''`
    );
    console.log(`  - Backfilled ${result.affectedRows} missing phone number(s) with a placeholder.`);
    await pool.query('ALTER TABLE users MODIFY COLUMN phone VARCHAR(30) NOT NULL');
    console.log('  - phone: now required.');
    if (result.affectedRows > 0) {
      console.log(`  ⚠️  ${result.affectedRows} user(s) have a placeholder phone number — ask them to update it.`);
    }
  }

  console.log('Migration complete — seller profiles and required phone numbers are ready.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
