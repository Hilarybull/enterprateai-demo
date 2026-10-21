-- ============================================================
-- Migration 043: the plans as sold (EnterprateAI_Pricing_Plans_AI_Agent_Final.pdf, 19 Oct 2026).
-- Explorer's 50 welcome AI credits are valid for 60 days (the app expires what is left of them on the
-- first balance read after day 60). The AI Business Plan Generator moves to Starter. Safe to run more than once,
-- and on a database where migration 016's plan_feature_entitlements table was never created.
-- ============================================================

UPDATE plan_credit_config SET expiry_enabled = TRUE, updated_at = NOW() WHERE plan_code = 'explorer';

-- The Business Plan Generator is on Starter and above. credit_feature_config.minimum_plan is what decides access
-- when there is no per-plan entitlement row.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'credit_feature_config' AND column_name = 'minimum_plan') THEN
        UPDATE credit_feature_config SET minimum_plan = 'starter_insight', updated_at = NOW()
         WHERE feature_code IN ('business_plan_full', 'business_plan_section');
    END IF;
END $$;

-- Where per-plan entitlements exist (migration 016), Explorer's are switched off too.
DO $$
BEGIN
    IF to_regclass('public.plan_feature_entitlements') IS NOT NULL THEN
        UPDATE plan_feature_entitlements SET enabled = FALSE
         WHERE plan_code = 'explorer' AND feature_code IN ('business_plan_full', 'business_plan_section');
    END IF;
END $$;

-- The welcome-credit expiry and the extra-seat credits are looked up by their reason, which the ledger keeps in
-- `description`: an index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_description ON credit_transactions(user_id, description);
