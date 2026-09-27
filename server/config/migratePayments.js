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

async function addColumnIfMissing(table, column, definition) {
  if (await columnExists(table, column)) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function migrate() {
  await addColumnIfMissing('users', 'paystack_recipient_code', 'VARCHAR(100) DEFAULT NULL');
  await addColumnIfMissing('users', 'payout_bank_name', 'VARCHAR(100) DEFAULT NULL');
  await addColumnIfMissing('users', 'payout_account_name', 'VARCHAR(150) DEFAULT NULL');
  await addColumnIfMissing('users', 'payout_account_last4', 'CHAR(4) DEFAULT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seller_orders (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      buyer_id INT NOT NULL,
      seller_id INT NOT NULL,
      listing_id INT NOT NULL,
      listing_title VARCHAR(200) NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(10,2) NOT NULL,
      item_subtotal DECIMAL(10,2) NOT NULL,
      delivery_method ENUM('pickup', 'delivery', 'service') NOT NULL,
      meeting_spot VARCHAR(150) DEFAULT NULL,
      delivery_address VARCHAR(500) DEFAULT NULL,
      delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      platform_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      paystack_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      total_amount DECIMAL(10,2) NOT NULL,
      seller_amount DECIMAL(10,2) NOT NULL,
      buyer_note TEXT DEFAULT NULL,
      status ENUM('requested', 'awaiting_payment', 'paid', 'payout_pending', 'payout_failed', 'completed', 'rejected', 'cancelled', 'refund_required') NOT NULL DEFAULT 'requested',
      payment_reference VARCHAR(100) DEFAULT NULL UNIQUE,
      checkout_url TEXT DEFAULT NULL,
      transfer_reference VARCHAR(100) DEFAULT NULL UNIQUE,
      paid_at DATETIME DEFAULT NULL,
      buyer_confirmed_at DATETIME DEFAULT NULL,
      seller_quoted_at DATETIME DEFAULT NULL,
      expires_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_seller_orders_buyer (buyer_id, created_at),
      INDEX idx_seller_orders_seller (seller_id, created_at),
      INDEX idx_seller_orders_status (status)
    )
  `);
  await addColumnIfMissing('seller_orders', 'paystack_fee', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumnIfMissing('seller_orders', 'expires_at', 'DATETIME DEFAULT NULL');

  console.log(`Payment tables and seller payout fields are ready in ${DB_NAME}.`);
}

migrate()
  .catch((err) => {
    console.error('Payment migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());