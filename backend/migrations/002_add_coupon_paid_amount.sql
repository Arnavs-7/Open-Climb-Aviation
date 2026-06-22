-- Migration: record the post-coupon amount + applied promo code on enrollments.
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.
-- paid_amount is in PAISE (e.g. ₹24,000 = 2400000).

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS paid_amount INTEGER;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS coupon_code TEXT;
