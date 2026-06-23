-- Migration: self-hosted visitor tracking.
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.
-- The backend writes/reads with the service key, so RLS is enabled with no
-- public policies (the service key bypasses RLS; anon/auth clients get nothing).

CREATE TABLE IF NOT EXISTS page_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path        TEXT,
  visitor_id  TEXT,                                   -- random id from browser localStorage ≈ unique visitor
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at);
CREATE INDEX IF NOT EXISTS page_views_visitor_id_idx ON page_views (visitor_id);

ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;
