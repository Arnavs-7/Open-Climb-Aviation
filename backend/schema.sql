-- ============================================================================
-- Open Climb Aviation — Database Schema (PostgreSQL / Supabase)
-- ----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL Editor (Dashboard → SQL → New
-- query) and click "Run". It is idempotent: safe to run more than once.
--
-- Tables and columns are derived directly from the backend routes:
--   users        ← routes/auth.js, middleware/auth.js, routes/admin.js
--   courses      ← routes/enrollment.js, routes/payment.js, routes/admin.js
--   enrollments  ← routes/enrollment.js, routes/payment.js, routes/admin.js
--   payments     ← routes/payment.js, routes/enrollment.js, routes/admin.js
--   enquiries    ← routes/auth.js (/enquiry), routes/admin.js
--
-- Money is stored in PAISE (integer). ₹25,000 = 2_500_000 paise.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto (already enabled on Supabase, but be safe)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS  (students + admins live in the same table, distinguished by `role`)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  email          TEXT        NOT NULL UNIQUE,
  whatsapp       TEXT,
  age            INTEGER     CHECK (age IS NULL OR (age BETWEEN 16 AND 100)),
  password_hash  TEXT        NOT NULL,                 -- bcrypt hash (12 rounds)
  role           TEXT        NOT NULL DEFAULT 'student'
                             CHECK (role IN ('student', 'admin')),
  email_verified BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
-- email already indexed by the UNIQUE constraint.

-- ============================================================================
-- COURSES
-- ============================================================================
CREATE TABLE IF NOT EXISTS courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,
  description   TEXT,
  price         INTEGER     NOT NULL CHECK (price >= 0),   -- in PAISE
  duration_days INTEGER     NOT NULL CHECK (duration_days >= 0),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_is_active ON courses (is_active);
-- slug already indexed by the UNIQUE constraint.

-- ============================================================================
-- ENROLLMENTS  (one row per user+course; status drives the lifecycle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id   UUID        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'paid', 'active', 'completed')),
  payment_id  TEXT,                                       -- Razorpay payment id (set on verify)
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- create-order reuses a single pending enrollment per (user, course)
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user_id   ON enrollments (user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments (course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status    ON enrollments (status);

-- ============================================================================
-- PAYMENTS  (one row per Razorpay order; updated in place on verify)
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  enrollment_id       UUID        NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  razorpay_order_id   TEXT        NOT NULL UNIQUE,        -- looked up on verify (.eq)
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,
  amount              INTEGER     NOT NULL CHECK (amount >= 0),  -- in PAISE
  status              TEXT        NOT NULL DEFAULT 'created'
                                  CHECK (status IN ('created', 'paid', 'failed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id       ON payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_enrollment_id ON payments (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status        ON payments (status);
-- razorpay_order_id already indexed by the UNIQUE constraint.

-- ============================================================================
-- ENQUIRIES  (public contact form — no auth, inserted by backend)
-- ============================================================================
CREATE TABLE IF NOT EXISTS enquiries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  whatsapp        TEXT,
  age             INTEGER     CHECK (age IS NULL OR (age BETWEEN 16 AND 100)),
  course_interest TEXT,
  message         TEXT,
  status          TEXT        NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'contacted', 'enrolled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_status     ON enquiries (status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created_at ON enquiries (created_at DESC);

-- ============================================================================
-- SEED — default courses (prices in paise: ₹25,000 and ₹10,000)
-- ============================================================================
INSERT INTO courses (name, slug, description, price, duration_days) VALUES
(
  'A320 Systems',
  'a320-systems',
  'Complete A320 systems training covering all aircraft systems in depth — hydraulics, electrics, pneumatics, fuel, flight controls and more. Ideal for pilots preparing for type rating.',
  2500000,
  20
),
(
  'Flows & Procedures incl. MCDU',
  'flows-procedures',
  'A320 flows, normal and abnormal procedures, and complete MCDU setup. Covers FMS programming, performance calculations, and standard operating procedures.',
  1000000,
  10
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- The backend connects with the Supabase SERVICE ROLE key, which BYPASSES RLS
-- entirely. So enabling RLS here costs the API nothing, but it is an important
-- safety net: it means that even if the (public) anon key ever leaks or is used
-- from the browser, NO rows are readable/writable without an explicit policy.
--
-- We intentionally add NO permissive policies — all data access goes through
-- the trusted Express backend. If you later add a browser-side Supabase client
-- with the anon key, add narrowly-scoped policies below (examples commented).
-- ============================================================================
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries   ENABLE ROW LEVEL SECURITY;

-- Example (DISABLED): let the public read the course catalogue with the anon key.
-- CREATE POLICY "courses are publicly readable"
--   ON courses FOR SELECT
--   TO anon
--   USING (is_active = TRUE);

-- ============================================================================
-- ADMIN ACCOUNT
-- ----------------------------------------------------------------------------
-- There is no admin sign-up endpoint, so create your admin by:
--   1) Registering normally through the website (POST /api/auth/register), then
--   2) Promoting that account to admin with the SQL below (replace the email):
--
-- UPDATE users SET role = 'admin' WHERE email = 'jaykotecha2003@gmail.com';
--
-- (Run that AFTER the account exists. The email must match ADMIN_EMAIL in .env
--  if you want admin notifications to go to the same inbox.)
-- ============================================================================
