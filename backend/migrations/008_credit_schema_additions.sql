-- ============================================================
-- Migration 008: Credit schema additions
-- Adds plan_code and workspace_id to credit_wallets,
-- workspace_id to credit_transactions (all nullable for safety).
-- ============================================================

ALTER TABLE credit_wallets
  ADD COLUMN IF NOT EXISTS plan_code TEXT,
  ADD COLUMN IF NOT EXISTS workspace_id TEXT;

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS workspace_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_id TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_wallets_plan_code ON credit_wallets(plan_code);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_workspace_id ON credit_transactions(workspace_id);

-- Add suggest_field feature if missing (idempotent)
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES ('suggest_field', 'AI Field Suggestion', 1, TRUE, 'explorer', FALSE)
ON CONFLICT (feature_code) DO NOTHING;
