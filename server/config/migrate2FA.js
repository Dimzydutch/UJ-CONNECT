/**
 * Migration: adds two-factor authentication columns to an EXISTING database
 * that was created before 2FA was introduced. Safe to run multiple times —
 * it checks for each column before adding it.
 *
 * Run with:
 *   npm run migrate-2fa
 *
 * New installs don't need this — schema.sql already includes these columns.
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
  console.log(`Checking "${DB_NAME}".users for two-factor authentication columns...`);

  const columns = [
    { name: 'two_factor_enabled', ddl: 'ADD COLUMN two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE' },
    { name: 'two_factor_secret', ddl: 'ADD COLUMN two_factor_secret VARCHAR(255) DEFAULT NULL' },
    { name: 'two_factor_temp_secret', ddl: 'ADD COLUMN two_factor_temp_secret VARCHAR(255) DEFAULT NULL' },
    { name: 'two_factor_backup_codes', ddl: 'ADD COLUMN two_factor_backup_codes TEXT DEFAULT NULL' }
  ];

  for (const col of columns) {
    const exists = await columnExists('users', col.name);
    if (exists) {
      console.log(`  - ${col.name}: already exists, skipping.`);
    } else {
      await pool.query(`ALTER TABLE users ${col.ddl}`);
      console.log(`  - ${col.name}: added.`);
    }
  }

  console.log('Migration complete — your database now supports two-factor authentication.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
