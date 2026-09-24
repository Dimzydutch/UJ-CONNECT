# UJ Connect 🎓

A campus marketplace web app where students sign up with their **school email** to buy/sell **goods** and offer/find **services**. Includes an **admin dashboard** for moderating listings, users, categories, and reports.

**Stack:** HTML, CSS, JavaScript (vanilla) · Node.js + Express · MySQL

---

## ✨ Features

- **School-email-only signup/login** — configurable domain check (defaults to `@unijos.edu.ng`), JWT-based sessions, **phone number required** at signup
- **Seller profiles** — before listing anything, students set up a seller profile with a description of what they sell and a public contact phone number; shown on every one of their listings alongside their rating
- **Goods & Services marketplace** — browse, search, filter by category/type/price, view details, prices shown in **Naira (₦)**
- **Self-service listing uploads** — students set their own price and condition (Brand New / Used), upload up to **5 photos**, and pick from a full category → subcategory taxonomy (12 goods categories, 11 service categories, 80+ subcategories); listings go to **pending** until an admin approves them
- **User dashboard** — manage your own listings (mark sold / delete), full **messaging inbox** with threaded conversations and replies
- **Reviews** — buyers can leave a star rating + comment for a seller after a transaction; sellers build up a public rating shown on every listing
- **Admin dashboard** — stats overview, approve/reject listings, suspend/delete users, manage categories, handle reports
- **Modern blue & white UI** with a **vertical hamburger sidebar** and **light/dark mode toggle** (persisted in localStorage)
- **Two-Factor Authentication (2FA)** — TOTP-based, works with any standard authenticator app (Google Authenticator, Authy, Microsoft Authenticator, 1Password, etc.), plus one-time backup codes for account recovery

---

## 📁 Project Structure

```
uj-connect/
├── package.json
├── .env.example
├── server/
│   ├── server.js              # Express app entry point
│   ├── config/
│   │   ├── db.js              # MySQL connection pool
│   │   ├── schema.sql         # Full DB schema + seed categories
│   │   ├── initDb.js          # One-command DB setup script
│   │   ├── migrate2FA.js      # Migration: adds 2FA columns to existing DBs
│   │   ├── migrateFeatures.js # Migration: adds listing_images + reviews tables
│   │   ├── migrateCategories.js # Migration: full category/subcategory taxonomy
│   │   ├── migrateSellerProfile.js # Migration: seller profile fields + required phone
│   │   ├── migrateQuantity.js # Migration: adds stock quantity to listings
│   │   ├── categoryData.js    # Source-of-truth taxonomy data (categories + subcategories)
│   │   └── seedCategories.js  # Idempotent seeder used by initDb.js and migrateCategories.js
│   ├── middleware/
│   │   ├── auth.js            # JWT verification, admin guard
│   │   └── upload.js          # Multer image upload config (up to 5 files)
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── listingController.js
│   │   ├── adminController.js
│   │   ├── messageController.js   # Conversations + threaded replies
│   │   └── reviewController.js    # Seller ratings/reviews
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── listingRoutes.js
│   │   ├── adminRoutes.js
│   │   ├── reportRoutes.js
│   │   ├── messageRoutes.js
│   │   └── reviewRoutes.js
│   └── uploads/                # Uploaded listing images land here
└── public/
    ├── index.html               # Landing page
    ├── login.html
    ├── signup.html
    ├── marketplace.html         # Browse all listings
    ├── listing.html             # Single listing detail + contact seller
    ├── dashboard.html           # Student dashboard (my listings, upload, inbox)
    ├── admin.html                # Admin dashboard
    ├── css/style.css
    └── js/
        ├── app.js                # Shared auth/theme/API helpers
        └── layout.js              # Injects topbar + sidebar on every page
```

---

## 🚀 Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org) v18+
- [MySQL](https://dev.mysql.com/downloads/) v8+ running locally (or a remote instance)

### 2. Install dependencies
```bash
cd uj-connect
npm install
```

### 3. Configure environment variables
Copy the example file and fill in your own values:
```bash
cp .env.example .env
```
Open `.env` and set at minimum:
- `DB_PASSWORD` — your MySQL root/user password
- `JWT_SECRET` / `SESSION_SECRET` — any long random strings
- `SCHOOL_EMAIL_DOMAIN` — the email domain allowed to sign up (default `unijos.edu.ng`)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — credentials for the first admin account

### 4. Initialize the database
This creates the database, all tables, seed categories, and your first admin account:
```bash
npm run init-db
```
You should see confirmation in the terminal, including the admin login you can use.

> **Already had UJ Connect installed before 2FA was added?** Don't re-run `init-db` (it would only skip existing tables anyway) — instead run the safe migration below to add the new 2FA columns to your existing `users` table:
> ```bash
> npm run migrate-2fa
> ```
> It only adds columns that don't already exist, so it's safe to run more than once.

> **Already had UJ Connect installed before multi-image uploads and reviews were added?** Run this migration too — it creates the `listing_images` and `reviews` tables and backfills any existing single-photo listings into the new gallery table:
> ```bash
> npm run migrate-features
> ```
> Also safe to run more than once.

> **Already had UJ Connect installed before the full category taxonomy was added?** Run this migration to replace the old flat category list with the full category → subcategory structure (Electronics & Gadgets → Phones, Laptops, etc.) and simplify the condition field to Brand New / Used:
> ```bash
> npm run migrate-categories
> ```
> ⚠️ This clears out the old `categories` table before reseeding — any listings using an old category just lose that link (they are NOT deleted), so only run this if you haven't launched with real category data yet. Also safe to run more than once.

> **Already had UJ Connect installed before seller profiles were added?** Run this migration to add the `is_seller` / `seller_bio` columns and make `phone` required:
> ```bash
> npm run migrate-seller-profile
> ```
> ⚠️ Any existing user with no phone on file gets a placeholder value ("Not provided") before the column is locked to required — ask those users to update it. Also safe to run more than once.

> **Already had UJ Connect installed before stock quantity was added?** Run this migration to add the `quantity` column (existing listings default to 1):
> ```bash
> npm run migrate-quantity
> ```
> Safe to run more than once.

### 5. Run the server
```bash
npm start
```
Or, for auto-reload during development (requires `nodemon`, already in devDependencies):
```bash
npm run dev
```

The app will be running at **http://localhost:5000**

---

## 👤 Using the App

1. **Sign up** at `/signup.html` using an email ending in your configured school domain (e.g. `yourname@unijos.edu.ng`) and a valid phone number — both are required.
2. **Set up your seller profile** — the first time you click "+ New Listing" (or the "Become a Seller" card on your dashboard), you'll be asked to describe what you sell and confirm a contact phone number. This only needs to be done once.
3. **Upload a listing** from your dashboard — choose Good or Service, add a title, price, condition (Brand New / Used), category → subcategory, description, and up to 5 photos. It's submitted as **pending**.
4. **Admins** log in with the admin account created during `init-db`, and are redirected to `/admin.html` where they can approve/reject listings, manage users, categories, and reports.
5. Once approved, listings appear publicly on `/marketplace.html` and the homepage — each shows the seller's bio, phone number, and rating.
6. Interested buyers can **message the seller** or **report** a listing directly from the listing detail page.

---

## 🔐 Two-Factor Authentication (2FA)

UJ Connect supports **TOTP-based 2FA** (the same standard used by Google Authenticator, Authy, Microsoft Authenticator, 1Password, etc.) — no SMS or email provider required, works fully offline.

**Enabling 2FA (as a student):**
1. Log in and go to your **Dashboard → Security** tab.
2. Click **Enable Two-Factor Authentication**.
3. Scan the QR code with your authenticator app (or enter the shown secret manually).
4. Enter the 6-digit code the app generates to confirm.
5. You'll be shown **8 one-time backup codes** — save these somewhere safe. Each can be used once to log in if you lose access to your authenticator app.

**Logging in with 2FA enabled:**
1. Enter your email and password as usual.
2. You'll be prompted for a 6-digit code from your authenticator app (or a backup code).
3. On success, you're logged in normally.

**Disabling 2FA:** From Dashboard → Security, click **Disable 2FA** and confirm with your password + a current code.

**Regenerating backup codes:** From Dashboard → Security, click **Regenerate Backup Codes** and confirm with a current code — this invalidates all previous backup codes.

### How it works under the hood
- `POST /api/auth/login` checks email + password. If 2FA is enabled on the account, it returns `{ requires2FA: true, tempToken }` instead of a full session — no JWT with real access is issued yet.
- `POST /api/auth/verify-2fa` exchanges that short-lived `tempToken` (5-minute expiry, single-purpose) plus a valid TOTP/backup code for a normal 7-day session token.
- The `tempToken` is rejected by all other protected routes (see `middleware/auth.js`), so it can't be used to access anything besides the 2FA challenge itself.
- Secrets are stored server-side in the `users` table (`two_factor_secret`); backup codes are stored bcrypt-hashed (`two_factor_backup_codes`), never in plaintext.

## 🎨 UI Notes

- Toggle **light/dark mode** using the circular button in the top bar (saved across visits).
- Click the **hamburger icon** (top-left, vertical lines) to collapse/expand the sidebar navigation — on mobile it slides in as an overlay.
- Color theme is blue (`#1456e8`) and white, with soft blue-tinted surfaces in dark mode too.

---

## 🔒 Security Notes for Production

- Change all default secrets in `.env` before deploying.
- Restrict MySQL user privileges to just what's needed for this database.
- Serve over HTTPS and set secure cookie flags if you switch from `Authorization` header tokens to cookies.
- Consider adding rate-limiting (e.g. `express-rate-limit`) on `/api/auth/*` routes.
- The uploaded images endpoint (`/uploads`) is public — do not upload sensitive files.

---

## 🛠️ Tech Details

- **Auth:** JWTs (7-day expiry) stored in `localStorage`, sent as `Authorization: Bearer <token>` on each API request.
- **Passwords:** hashed with `bcryptjs` (10 salt rounds).
- **Image uploads:** handled by `multer`, stored on disk under `server/uploads/`, max 5MB, image types only.
- **Database:** raw SQL via `mysql2/promise` connection pool (no ORM) — see `server/config/schema.sql` for full schema.

Enjoy building on UJ Connect! 🎉
