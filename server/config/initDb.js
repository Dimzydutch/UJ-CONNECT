/**
 * Run this once to set up the database:
 *   npm run init-db
 *
 * It will:
 * 1. Execute schema.sql (creates database and all tables)
 * 2. Seed the full category/subcategory taxonomy
 * 3. Create the first admin account from your .env values
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const seedCategories = require('./seedCategories');
require('dotenv').config();

async function init() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306,
    multipleStatements: true
  });

  console.log('Connected to MySQL server...');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  console.log('Running schema.sql (creating database + tables)...');
  await connection.query(schema);
  console.log('Schema applied successfully.');

  await connection.changeUser({ database: process.env.DB_NAME || 'uj_connect' });

  console.log('Seeding category taxonomy...');
  const { categoriesAdded, subcategoriesAdded } = await seedCategories(connection);
  console.log(`  - Added ${categoriesAdded} categories and ${subcategoriesAdded} subcategories.`);

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@unijos.edu.ng';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const adminName = process.env.ADMIN_NAME || 'UJ Connect Admin';
  const adminPhone = process.env.ADMIN_PHONE || '0000000000';

  const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [adminEmail]);

  if (existing.length === 0) {
    const hashed = await bcrypt.hash(adminPassword, 10);
    await connection.query(
      'INSERT INTO users (full_name, email, password, phone, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [adminName, adminEmail, hashed, adminPhone, 'admin', 'active']
    );
    console.log(`Admin account created: ${adminEmail} / ${adminPassword}`);
    console.log('IMPORTANT: log in and change this password.');
  } else {
    console.log(`Admin account already exists for ${adminEmail}, skipping creation.`);
  }

  await connection.end();
  console.log('Database initialization complete.');
  process.exit(0);
}

init().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
