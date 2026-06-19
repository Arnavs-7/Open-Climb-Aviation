-- Migration: add the combined Pre-TR package + the Career Counselling course
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.
-- Prices are stored in PAISE (₹33,000 = 3300000, ₹5,000 = 500000).

INSERT INTO courses (id, name, slug, description, price, duration_days) VALUES
(
  gen_random_uuid(),
  'A320 Systems + Flows & Procedures',
  'a320-systems-flows-procedures',
  'The complete Pre-TR package — A320 systems plus full cockpit flows, MCDU and PF/PM duties. Everything you need to walk into your Type Rating fully prepared.',
  3300000,
  28
),
(
  gen_random_uuid(),
  'Career Counselling Session',
  'career-counselling-session',
  'Personalized one-on-one guidance on your aviation career path directly from Capt. Jay Kotecha.',
  500000,
  1
)
ON CONFLICT (slug) DO NOTHING;
