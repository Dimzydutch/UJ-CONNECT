/**
 * Migration: adds the `quantity` column to listings for an EXISTING
 * database created before stock quantity was supported.
 *
 * Run with:
 *   npm run migrate-quantity
 *
 * Existing listings default to quantity = 1. Safe to run more than once.
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

async function migrate() {
  console.log(`Checking "${DB_NAME}".listings for the quantity column...`);

  const hasQuantity = await columnExists('listings', 'quantity');
  if (hasQuantity) {
    console.log('  - quantity: already exists, skipping.');
  } else {
    await pool.query(
      'ALTER TABLE listings ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER price'
    );
    console.log('  - quantity: added (existing listings default to 1).');
  }

  console.log('Migration complete — listings now support stock quantity.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
