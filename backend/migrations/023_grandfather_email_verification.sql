-- Fix a regression from 022_users_missing_columns.sql: adding
-- `email_verified boolean NOT NULL DEFAULT false` backfilled every existing
-- user to false, which retroactively enforced a verification requirement
-- that never actually applied to them (the login check was already in the
-- code, it just silently never triggered while the column didn't exist).
--
-- Grandfather everyone who signed up before this fix as verified; anyone
-- signing up after it still goes through the real verify-email flow. The
-- cutoff is a fixed timestamp, not "now()", so this stays safe to run more
-- than once — it never reaches forward to grandfather a genuinely new,
-- unverified signup.

UPDATE users
SET email_verified = true
WHERE email_verified = false
  AND created_at < '2026-09-13T00:00:00Z';
