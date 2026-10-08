-- ============================================================
-- Migration 026: Email verification on sign-up.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_verification_token TEXT;

-- Default to verified: only email/password sign-up explicitly writes FALSE.
-- Google sign-ins, the demo account and admin-created users never receive a
-- verification email and must not be locked out.
ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT TRUE;

-- Grandfather existing accounts. Anyone unverified without a token signed up
-- before this flow existed and was never sent a link; unverified accounts
-- WITH a token are genuine pending sign-ups and stay unverified.
UPDATE users
SET email_verified = TRUE
WHERE email_verified = FALSE
  AND email_verification_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_email_verification_token
  ON users(email_verification_token)
  WHERE email_verification_token IS NOT NULL;

NOTIFY pgrst, 'reload schema';
