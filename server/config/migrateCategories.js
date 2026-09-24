/**
 * Migration: replaces the old flat category list with the full
 * category → subcategory taxonomy, and adds the columns/tables needed
 * to support it.
 *
 * Run with:
 *   npm run migrate-categories
 *
 * IMPORTANT: this clears out the `categories` table first (existing
 * listings simply lose their category link — set to NULL — they are
 * NOT deleted) before reseeding with the full taxonomy. This is meant
 * for projects that haven't gone live with real category data yet. If
 * you've already launched with the old category list, back up your
 * database before running this.
 *
 * Safe to run more than once.
 */
const pool = require('./db');
const seedCategories = require('./seedCategories');
require('dotenv').config();

const DB_NAME = process.env.DB_NAME || 'uj_connect';

async function tableExists(table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [DB_NAME, table]
  );
  return rows[0].cnt > 0;
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [DB_NAME, table, column]
  );
  return rows[0].cnt > 0;
}

async function migrate() {
  console.log(`Migrating "${DB_NAME}" to the full category taxonomy...`);

  // 1. Create subcategories table if it doesn't exist yet
  const hasSubcategories = await tableExists('subcategories');
  if (hasSubcategories) {
    console.log('  - subcategories table: already exists, skipping.');
  } else {
    await pool.query(`
      CREATE TABLE subcategories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE KEY unique_subcategory_per_category (category_id, name)
      )
    `);
    console.log('  - subcategories table: created.');
  }

  // 2. Add listings.subcategory_id if missing
  const hasSubcategoryCol = await columnExists('listings', 'subcategory_id');
  if (hasSubcategoryCol) {
    console.log('  - listings.subcategory_id: already exists, skipping.');
  } else {
    await pool.query(`
      ALTER TABLE listings
      ADD COLUMN subcategory_id INT DEFAULT NULL AFTER category_id,
      ADD FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL
    `);
    console.log('  - listings.subcategory_id: added.');
  }

  // 3. Normalize condition_type values before narrowing the enum:
  //    'like_new' collapses into 'used', and 'new' is renamed to 'brand_new'
  //    to match the simplified Brand New / Used dropdown.
  //    MySQL ENUMs only accept values already defined in the column, so we
  //    widen the enum first, rewrite the data, then narrow it to the final set.
  await pool.query(`
    ALTER TABLE listings
    MODIFY COLUMN condition_type ENUM('new', 'used', 'like_new', 'n_a', 'brand_new') DEFAULT 'n_a'
  `);
  await pool.query(`UPDATE listings SET condition_type = 'used' WHERE condition_type = 'like_new'`);
  await pool.query(`UPDATE listings SET condition_type = 'brand_new' WHERE condition_type = 'new'`);
  await pool.query(`
    ALTER TABLE listings
    MODIFY COLUMN condition_type ENUM('brand_new', 'used', 'n_a') DEFAULT 'n_a'
  `);
  console.log('  - listings.condition_type: narrowed to brand_new / used / n_a.');

  // 4. Clear out the old flat category list, then reseed with the full taxonomy.
  //    ON DELETE SET NULL means any listings using an old category just lose
  //    that link rather than being deleted.
  const [[{ cnt: oldCategoryCount }]] = await pool.query('SELECT COUNT(*) AS cnt FROM categories');
  await pool.query('DELETE FROM categories');
  console.log(`  - Cleared ${oldCategoryCount} old categories (and their subcategories).`);

  // Widen the type enum first in case old rows used 'both' (now removed)
  await pool.query(`
    ALTER TABLE categories
    MODIFY COLUMN type ENUM('goods', 'services') NOT NULL
  `);

  const { categoriesAdded, subcategoriesAdded } = await seedCategories(pool);
  console.log(`  - Seeded ${categoriesAdded} categories and ${subcategoriesAdded} subcategories.`);

  console.log('Migration complete — the full category taxonomy is ready to use.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
