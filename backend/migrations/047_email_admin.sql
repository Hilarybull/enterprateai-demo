-- ============================================================
-- Migration 047: the superadmin's Emails area.
--
-- 1. email_log: one row for every email the platform sends or holds back: which kind,
--    to whom, the subject, and what happened (sent, failed, uncertain, switched off,
--    email not set up). Who sent it, for the ones written in the superadmin.
-- 2. email_settings: per kind of email, whether it is switched on, and edited wording
--    (empty means the wording written in the product). Who changed it and when.
--
-- Both hold email addresses or admin choices, so row level security is on with no
-- policies: only the backend's service role can read or write them.
--
-- Additive only. Safe to run more than once.
-- To reverse: DROP TABLE email_log, email_settings;
-- ============================================================

CREATE TABLE IF NOT EXISTS email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                TEXT NOT NULL DEFAULT 'other',
  to_email            TEXT NOT NULL,
  subject             TEXT,
  status              TEXT NOT NULL,             -- sent | failed | uncertain | switched_off | not_configured
  error               TEXT,
  provider_message_id TEXT,
  sent_by             TEXT,                      -- the admin who wrote it, for one-off emails
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_kind    ON email_log (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_to      ON email_log (to_email);

CREATE TABLE IF NOT EXISTS email_settings (
  kind         TEXT PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  subject      TEXT,
  body         TEXT,
  button_label TEXT,
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_settings ENABLE ROW LEVEL SECURITY;
