-- ============================================================
-- Migration 033: Activation and education emails.
--
-- 1. A permission record on each user. Every existing account starts at
--    'unknown', which is NOT a permission: nobody is emailed until permission
--    is recorded for them (a tick at sign-up, the preference page, or an
--    administrator recording the evidence for one account).
-- 2. The journey ledger: one row per (user, journey, step), so a step can be
--    scheduled, claimed and sent exactly once.
-- 3. An event log: journey starts, sends, delivery events from the provider,
--    unsubscribes. A provider event is stored once however often it arrives.
--
-- Additive only, and safe to run more than once.
-- To reverse: DROP TABLE activation_events, activation_ledger; then
--   ALTER TABLE users DROP COLUMN verified_at, DROP COLUMN timezone,
--     DROP COLUMN marketing_email_status, DROP COLUMN marketing_permission_source,
--     DROP COLUMN marketing_permission_at, DROP COLUMN marketing_unsubscribed_at,
--     DROP COLUMN marketing_suppression_reason, DROP COLUMN marketing_permission_wording,
--     DROP COLUMN marketing_last_change_source, DROP COLUMN marketing_prompt_answered_at;
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_at                  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone                     TEXT,
  ADD COLUMN IF NOT EXISTS marketing_email_status       TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS marketing_permission_source  TEXT,
  ADD COLUMN IF NOT EXISTS marketing_permission_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_suppression_reason TEXT,
  ADD COLUMN IF NOT EXISTS marketing_permission_wording TEXT,          -- which version of the wording the person agreed to
  ADD COLUMN IF NOT EXISTS marketing_last_change_source TEXT,          -- where the latest change (on or off) was made
  ADD COLUMN IF NOT EXISTS marketing_prompt_answered_at TIMESTAMPTZ;   -- the one-time question after a Google sign-up: asked once

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_marketing_email_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_marketing_email_status_check
      CHECK (marketing_email_status IN ('unknown', 'subscribed', 'soft_opt_in', 'unsubscribed', 'suppressed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS activation_ledger (
  id                  UUID PRIMARY KEY,
  user_id             TEXT NOT NULL,
  journey_key         TEXT NOT NULL,              -- A | B | C
  step_key            TEXT NOT NULL,              -- a1..a5, b1..b3, or a tip key
  due_at              TIMESTAMPTZ NOT NULL,
  state               TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled | sending | sent | uncertain | cancelled | holdout | failed
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  sent_at             TIMESTAMPTZ,
  stopped_reason      TEXT,
  template_version    TEXT,
  delivery_status     TEXT,                       -- accepted | delivered | bounced | complained | suppressed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A step exists once for a user: retries and duplicate jobs cannot create or send a second.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_ledger_step ON activation_ledger (user_id, journey_key, step_key);
CREATE INDEX IF NOT EXISTS idx_activation_ledger_due     ON activation_ledger (state, due_at);
CREATE INDEX IF NOT EXISTS idx_activation_ledger_message ON activation_ledger (provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS activation_events (
  id          UUID PRIMARY KEY,
  user_id     TEXT,
  type        TEXT NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- identifiers and states only: never business content
  dedupe_key  TEXT
);

-- The same provider event, or the same journey start, is recorded once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_events_dedupe ON activation_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activation_events_user ON activation_events (user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activation_events_type ON activation_events (type, at DESC);

ALTER TABLE activation_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
