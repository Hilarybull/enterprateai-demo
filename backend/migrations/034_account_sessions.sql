-- ============================================================
-- Migration 034: "Sign out of other devices".
--
-- A sign-in issued before this moment is no longer accepted for the user.
-- NULL (every existing account) means nothing has been signed out.
-- Additive, and safe to run more than once.
-- To reverse: ALTER TABLE users DROP COLUMN sessions_valid_after;
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
