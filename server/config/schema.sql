-- UJ Connect Database Schema
CREATE DATABASE IF NOT EXISTS uj_connect;
USE uj_connect;

-- Users table (students, sellers, admins - all sign up with school email)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    student_number VARCHAR(50) DEFAULT NULL,
    phone VARCHAR(30) NOT NULL,
    is_seller BOOLEAN NOT NULL DEFAULT FALSE,
    seller_bio TEXT DEFAULT NULL,
    paystack_recipient_code VARCHAR(100) DEFAULT NULL,
    payout_bank_name VARCHAR(100) DEFAULT NULL,
    payout_account_name VARCHAR(150) DEFAULT NULL,
    payout_account_last4 CHAR(4) DEFAULT NULL,
    role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
    status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
    avatar VARCHAR(255) DEFAULT NULL,
    -- Email OTP verification: FALSE until the user confirms the 6-digit code
    -- sent to their school email at registration. Unverified accounts cannot log in.
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_secret VARCHAR(255) DEFAULT NULL,
    two_factor_temp_secret VARCHAR(255) DEFAULT NULL,
    two_factor_backup_codes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Main categories for listings (e.g. "Electronics & Gadgets", "Technology & Digital Services")
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    type ENUM('goods', 'services') NOT NULL,
    icon VARCHAR(50) DEFAULT 'tag'
);

-- Subcategories nested under a main category (e.g. "Phones" under "Electronics & Gadgets")
CREATE TABLE IF NOT EXISTS subcategories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE KEY unique_subcategory_per_category (category_id, name)
);

-- Listings table (goods and services uploaded by users)
CREATE TABLE IF NOT EXISTS listings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT DEFAULT NULL,
    subcategory_id INT DEFAULT NULL,
    listing_type ENUM('good', 'service') NOT NULL DEFAULT 'good',
    title VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    quantity INT NOT NULL DEFAULT 1,
    condition_type ENUM('brand_new', 'used', 'n_a') DEFAULT 'n_a',
    location VARCHAR(150) DEFAULT NULL,
    image VARCHAR(255) DEFAULT NULL,
    status ENUM('pending', 'approved', 'rejected', 'sold') NOT NULL DEFAULT 'pending',
    views INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL
);

-- Additional images per listing (users can upload several photos of one item/service)
CREATE TABLE IF NOT EXISTS listing_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    listing_id INT NOT NULL,
    image_path VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

-- Messages / inquiries between buyers and sellers
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    listing_id INT NOT NULL,
    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Buyer payments held until delivery is confirmed, then transferred to sellers.
-- No raw bank account number or card data is stored by UJ Connect.
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
);

-- Reviews left by buyers about a seller, tied to a specific listing/transaction
CREATE TABLE IF NOT EXISTS reviews (
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
);

-- Reports (users reporting bad listings for admin review)
CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    listing_id INT NOT NULL,
    reporter_id INT NOT NULL,
    reason VARCHAR(255) NOT NULL,
    status ENUM('open', 'resolved') DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
);

-- One-time codes for email verification (registration OTP flow).
-- Each row is one issued code; a fresh send-otp call deletes any older,
-- unconsumed rows for that user so only the newest code is ever valid.
CREATE TABLE IF NOT EXISTS email_otps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    email VARCHAR(150) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,       -- HMAC-SHA256(email + code), never the plain code
    purpose VARCHAR(30) NOT NULL DEFAULT 'email_verification',
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    expires_at DATETIME NOT NULL,          -- 10 minutes from issue time
    consumed_at DATETIME DEFAULT NULL,     -- set once the code is successfully used
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_email_otps_user_purpose (user_id, purpose)
);

-- Category and subcategory data is seeded by server/config/seedCategories.js
-- (run automatically by init-db, and available via migrate-categories for existing installs)
