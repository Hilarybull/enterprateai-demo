-- ============================================================
-- Migration 046: requests left on a Marketplace profile nobody has claimed yet.
--
-- A visitor can ask for a quote or ask a question on an unclaimed profile. The request
-- waits here, privately, until a claim on that profile is verified, and is then handed to
-- that business's own requests. It holds the sender's contact details, so row level security
-- is on with no policies: only the backend's service role can read it.
--
-- Additive only. Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS marketplace_held_requests (
  id           UUID PRIMARY KEY,
  business_id  TEXT NOT NULL,              -- always "marketplace" until it is handed over
  kind         TEXT NOT NULL,              -- quote | enquiry
  subject_id   UUID,                       -- the directory profile it was left on
  status       TEXT,                       -- held | delivered
  revision     INTEGER NOT NULL DEFAULT 1,
  key          TEXT,
  data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_held_requests_scope   ON marketplace_held_requests (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_held_requests_profile ON marketplace_held_requests (subject_id, created_at DESC);

ALTER TABLE marketplace_held_requests ENABLE ROW LEVEL SECURITY;
