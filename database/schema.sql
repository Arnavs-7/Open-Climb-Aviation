-- Open Climb Aviation Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================
-- USERS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  whatsapp      TEXT,
  age           INTEGER,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'student', -- 'student' or 'admin'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_verified BOOLEAN NOT NULL DEFAULT false
);

-- =====================
-- COURSES TABLE
-- =====================
CREATE TABLE IF NOT EXISTS courses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE,
  description   TEXT,
  price         INTEGER,       -- stored in paise (₹25000 = 2500000)
  duration_days INTEGER,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================
-- ENROLLMENTS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS enrollments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'active', 'completed'
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_id  TEXT  -- Razorpay payment ID
);

-- =====================
-- PAYMENTS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id         UUID REFERENCES enrollments(id) ON DELETE CASCADE,
  razorpay_order_id     TEXT,
  razorpay_payment_id   TEXT,
  razorpay_signature    TEXT,
  amount                INTEGER, -- in paise
  status                TEXT NOT NULL DEFAULT 'created', -- 'created', 'paid', 'failed'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================
-- ENQUIRIES TABLE
-- =====================
CREATE TABLE IF NOT EXISTS enquiries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT,
  email           TEXT,
  whatsapp        TEXT,
  age             INTEGER,
  course_interest TEXT,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'new', -- 'new', 'contacted', 'enrolled'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================
-- DEFAULT COURSES
-- =====================
INSERT INTO courses (id, name, slug, description, price, duration_days) VALUES
(
  gen_random_uuid(),
  'A320 Systems',
  'a320-systems',
  'Complete A320 systems training covering all aircraft systems in depth — hydraulics, electrics, pneumatics, fuel, flight controls and more. Ideal for pilots preparing for type rating.',
  2500000,
  20
),
(
  gen_random_uuid(),
  'Flows & Procedures incl. MCDU',
  'flows-procedures',
  'A320 flows, normal and abnormal procedures, and complete MCDU setup. Covers FMS programming, performance calculations, and standard operating procedures.',
  1000000,
  10
)
ON CONFLICT (slug) DO NOTHING;

-- =====================
-- ROW LEVEL SECURITY
-- =====================
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiries   ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by backend)
-- These policies are bypassed by the service key automatically.
-- Add RLS policies below if you also use anon/authenticated Supabase clients.
