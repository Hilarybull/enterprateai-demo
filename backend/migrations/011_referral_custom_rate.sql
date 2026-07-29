-- Migration 011: per-participant custom commission rate
-- Run in Supabase SQL editor

ALTER TABLE referral_participants
  ADD COLUMN IF NOT EXISTS custom_rate_bps INTEGER;

COMMENT ON COLUMN referral_participants.custom_rate_bps IS
  'Override commission rate in basis points (e.g. 750 = 7.5%). NULL means use global programme_config_versions rate.';
