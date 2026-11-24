-- ============================================================
-- Migration 048: what happened to each email after it was sent.
--
-- Resend reports each email's events to /webhooks/resend: delivered, delayed, opened,
-- clicked, bounced, complained. They are kept on the email's row in email_log
-- (migration 047), matched by the provider's message id. `events` keeps each event
-- id once, so an event Resend sends twice is counted once.
--
-- Opens and clicks are only reported when open and click tracking are switched on for
-- the sending domain in Resend. An "open" is the email's images loading: some mail apps
-- load them without the email being read, and others block them.
--
-- Also: email_optouts, who asked not to get optional emails (see the end).
--
-- Additive only. Safe to run more than once. Run 047_email_admin.sql first.
-- To reverse: ALTER TABLE email_log DROP COLUMN delivered_at, DROP COLUMN delayed_at,
--   DROP COLUMN opened_at, DROP COLUMN last_opened_at, DROP COLUMN open_count,
--   DROP COLUMN clicked_at, DROP COLUMN last_clicked_at, DROP COLUMN click_count,
--   DROP COLUMN last_clicked_link, DROP COLUMN bounced_at, DROP COLUMN bounce_reason,
--   DROP COLUMN complained_at, DROP COLUMN events; DROP TABLE email_optouts;
-- ============================================================

ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delayed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at         TIMESTAMPTZ,      -- first open
  ADD COLUMN IF NOT EXISTS last_opened_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS open_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_at        TIMESTAMPTZ,      -- first click
  ADD COLUMN IF NOT EXISTS last_clicked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS click_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_clicked_link TEXT,
  ADD COLUMN IF NOT EXISTS bounced_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_reason     TEXT,
  ADD COLUMN IF NOT EXISTS complained_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS events            JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_email_log_message ON email_log (provider_message_id);

-- Opt-outs: someone who doesn't want a kind of optional email (or any of them) from us, by address,
-- whether or not they have an account. Essential emails (password links, codes, things the person
-- asked for) are never held back by this. kind 'all' means every optional email.
CREATE TABLE IF NOT EXISTS email_optouts (
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  source     TEXT,                      -- unsubscribe_link | one_click | admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, kind)
);

ALTER TABLE email_optouts ENABLE ROW LEVEL SECURITY;
