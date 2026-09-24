/**
 * Migration: adds support for multiple listing images + seller reviews
 * to an EXISTING database created before these features existed.
 *
 * Run with:
 *   npm run migrate-features
 *
 * Safe to run multiple times — it checks before creating tables and
 * only backfills listing_images rows that don't already exist.
 *
 * New installs don't need this — schema.sql already includes these tables.
 */
const pool = require('./db');
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

async function migrate() {
  console.log(`Checking "${DB_NAME}" for multi-image + reviews support...`);

  const hasListingImages = await tableExists('listing_images');
  if (hasListingImages) {
    console.log('  - listing_images table: already exists, skipping.');
  } else {
    await pool.query(`
      CREATE TABLE listing_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        listing_id INT NOT NULL,
        image_path VARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
      )
    `);
    console.log('  - listing_images table: created.');
  }

  const hasReviews = await tableExists('reviews');
  if (hasReviews) {
    console.log('  - reviews table: already exists, skipping.');
  } else {
    await pool.query(`
      CREATE TABLE reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        listing_id INT NOT NULL,
        seller_id INT NOT NULL,
        reviewer_id INT NOT NULL,
        rating TINYINT NOT NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_review_per_listing (reviewer_id, listing_id),
        CONSTRAINT rating_range CHECK (rating BETWEEN 1 AND 5)
      )
    `);
    console.log('  - reviews table: created.');
  }

  // Backfill: copy each listing's existing single "image" column into
  // listing_images, so older listings still show a photo in the gallery.
  const [result] = await pool.query(`
    INSERT INTO listing_images (listing_id, image_path, sort_order)
    SELECT l.id, l.image, 0
    FROM listings l
    WHERE l.image IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM listing_images li WHERE li.listing_id = l.id
      )
  `);
  console.log(`  - Backfilled ${result.affectedRows} existing listing photo(s) into listing_images.`);

  console.log('Migration complete — multi-image uploads and reviews are ready to use.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
