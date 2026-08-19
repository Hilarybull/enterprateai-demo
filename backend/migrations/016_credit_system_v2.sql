-- ============================================================
-- Migration 016: Credit-Based Usage System v2
-- Updates feature costs, plan allocations, and feature entitlements
-- for the Explorer / Starter Insight / Decision Engine tier model.
-- ============================================================

ALTER TABLE credit_feature_config
  ADD COLUMN IF NOT EXISTS credit_controlled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS plan_feature_entitlements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code      TEXT NOT NULL,
    feature_code   TEXT NOT NULL,
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_code, feature_code)
);

CREATE INDEX IF NOT EXISTS idx_plan_feature_entitlements_plan_code
    ON plan_feature_entitlements(plan_code);

CREATE INDEX IF NOT EXISTS idx_plan_feature_entitlements_feature_code
    ON plan_feature_entitlements(feature_code);

-- Backfill plan_code on wallets where we already know the subscription plan.
UPDATE credit_wallets w
SET plan_code = CASE
    WHEN s.plan_key = 'free_trial' THEN 'explorer'
    WHEN s.plan_key = 'insight_starter' THEN 'starter_insight'
    ELSE COALESCE(s.plan_key, w.plan_code)
END
FROM user_subscriptions s
WHERE s.user_id = w.user_id
  AND (w.plan_code IS NULL OR w.plan_code = '');

-- ------------------------------------------------------------
-- V2 feature catalog
-- ------------------------------------------------------------
INSERT INTO credit_feature_config (
    feature_code,
    feature_name,
    credit_cost,
    enabled,
    minimum_plan,
    refundable_on_failure,
    credit_controlled
)
VALUES
    ('idea_validation',               'Idea Validation',                        5,  TRUE, 'explorer',        TRUE,  TRUE),
    ('idea_validation_comprehensive',  'Idea Validation (Comprehensive)',       10,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('market_data_refresh',           'Market Data Refresh',                    4,  TRUE, 'explorer',        TRUE,  TRUE),
    ('business_plan_full',            'Complete Business Plan',                40,  TRUE, 'explorer',        TRUE,  TRUE),
    ('business_plan_section',         'Regenerate Business Plan Section',       3,  TRUE, 'explorer',        TRUE,  TRUE),
    ('proposal_full',                 'Complete Business Proposal',            25,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('proposal_section',              'Regenerate Proposal Section',            2,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('sales_letter_full',             'Complete Sales Letter',                 10,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('sales_letter_section',          'Regenerate Sales Letter Section',        1,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('fragility_ai_interpretation',    'AI Fragility Index Interpretation',      3,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('scenario_simulation',            'Scenario Simulation',                    0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('scenario_deterministic',         'Scenario Deterministic Run',             0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('scenario_multi_compare_deterministic', 'Scenario Multi-Compare',          0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('sensitivity_deterministic',      'Sensitivity Deterministic Run',          0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('breakpoint_deterministic',        'Break-even Deterministic Run',           0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('safe_zone_deterministic',         'Safe Zone Deterministic Run',            0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('scenario_ai_interpretation',      'Scenario AI Interpretation',             3,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('scenario_ai_recommendation',      'Scenario AI Recommendation',             3,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('scenario_comparison_ai_summary',   'Scenario Comparison AI Summary',         5,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('sensitivity_ai_interpretation',    'Sensitivity AI Interpretation',          3,  TRUE, 'starter_insight', TRUE,  TRUE),
    ('live_plan_kpi_refresh',            'Live Plan KPI Refresh',                 0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('live_plan_variance',               'Live Plan Variance',                    0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('live_plan_scenario_adopt',         'Live Plan Scenario Adoption',           0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('live_plan_import_extract',         'Live Plan Import & Extract',           10,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('live_plan_section_refresh',        'Live Plan Section Refresh',             3,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('live_plan_variance_interpretation','Live Plan Variance Interpretation',     3,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('decision_ai_summary',              'Decision AI Summary',                   3,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('decision_narrative_update',        'Decision Narrative Update',             5,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('live_plan_full_refresh',           'Live Plan Full Refresh',               20,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('live_plan_monthly_review',         'Live Plan Monthly Review',             10,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('integration_sync',                 'Integration Sync',                       0,  TRUE, 'decision_engine', TRUE,  FALSE),
    ('integration_ai_insight',           'Integration AI Insight',                3,  TRUE, 'decision_engine',  TRUE,  TRUE),
    ('engine_recalculation',             'Engine Recalculation',                   0,  TRUE, 'explorer',        TRUE,  FALSE),
    ('suggest_field',                    'AI Field Suggestion',                    2,  TRUE, 'explorer',        FALSE, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    credit_cost = EXCLUDED.credit_cost,
    enabled = EXCLUDED.enabled,
    minimum_plan = EXCLUDED.minimum_plan,
    refundable_on_failure = EXCLUDED.refundable_on_failure,
    credit_controlled = EXCLUDED.credit_controlled,
    updated_at = NOW();

-- ------------------------------------------------------------
-- V2 plan allocations
-- ------------------------------------------------------------
INSERT INTO plan_credit_config (
    plan_code,
    allocation_type,
    credits_per_period,
    reset_frequency,
    rollover_enabled,
    expiry_enabled,
    enabled
)
VALUES
    ('explorer',             'one_time',  50,   'never',   FALSE, FALSE, TRUE),
    ('starter_insight',      'monthly',   500,   'monthly', FALSE, TRUE,  TRUE),
    ('decision_engine',      'monthly',  2000,   'monthly', FALSE, TRUE,  TRUE)
ON CONFLICT (plan_code) DO UPDATE SET
    allocation_type = EXCLUDED.allocation_type,
    credits_per_period = EXCLUDED.credits_per_period,
    reset_frequency = EXCLUDED.reset_frequency,
    rollover_enabled = EXCLUDED.rollover_enabled,
    expiry_enabled = EXCLUDED.expiry_enabled,
    enabled = EXCLUDED.enabled,
    updated_at = NOW();

-- ------------------------------------------------------------
-- V2 plan entitlements
-- ------------------------------------------------------------
INSERT INTO plan_feature_entitlements (plan_code, feature_code, enabled)
VALUES
    ('explorer', 'idea_validation', TRUE),
    ('explorer', 'market_data_refresh', TRUE),
    ('explorer', 'business_plan_full', TRUE),
    ('explorer', 'business_plan_section', TRUE),
    ('explorer', 'scenario_simulation', TRUE),
    ('explorer', 'scenario_deterministic', TRUE),
    ('explorer', 'scenario_multi_compare_deterministic', TRUE),
    ('explorer', 'sensitivity_deterministic', TRUE),
    ('explorer', 'breakpoint_deterministic', TRUE),
    ('explorer', 'safe_zone_deterministic', TRUE),
    ('explorer', 'live_plan_kpi_refresh', TRUE),
    ('explorer', 'live_plan_variance', TRUE),
    ('explorer', 'live_plan_scenario_adopt', TRUE),
    ('explorer', 'engine_recalculation', TRUE),

    ('starter_insight', 'idea_validation', TRUE),
    ('starter_insight', 'idea_validation_comprehensive', TRUE),
    ('starter_insight', 'market_data_refresh', TRUE),
    ('starter_insight', 'business_plan_full', TRUE),
    ('starter_insight', 'business_plan_section', TRUE),
    ('starter_insight', 'proposal_full', TRUE),
    ('starter_insight', 'proposal_section', TRUE),
    ('starter_insight', 'sales_letter_full', TRUE),
    ('starter_insight', 'sales_letter_section', TRUE),
    ('starter_insight', 'fragility_ai_interpretation', TRUE),
    ('starter_insight', 'scenario_simulation', TRUE),
    ('starter_insight', 'scenario_deterministic', TRUE),
    ('starter_insight', 'scenario_multi_compare_deterministic', TRUE),
    ('starter_insight', 'sensitivity_deterministic', TRUE),
    ('starter_insight', 'breakpoint_deterministic', TRUE),
    ('starter_insight', 'safe_zone_deterministic', TRUE),
    ('starter_insight', 'scenario_ai_interpretation', TRUE),
    ('starter_insight', 'scenario_ai_recommendation', TRUE),
    ('starter_insight', 'scenario_comparison_ai_summary', TRUE),
    ('starter_insight', 'sensitivity_ai_interpretation', TRUE),
    ('starter_insight', 'live_plan_kpi_refresh', TRUE),
    ('starter_insight', 'live_plan_variance', TRUE),
    ('starter_insight', 'live_plan_scenario_adopt', TRUE),
    ('starter_insight', 'engine_recalculation', TRUE),

    ('decision_engine', 'idea_validation', TRUE),
    ('decision_engine', 'idea_validation_comprehensive', TRUE),
    ('decision_engine', 'market_data_refresh', TRUE),
    ('decision_engine', 'business_plan_full', TRUE),
    ('decision_engine', 'business_plan_section', TRUE),
    ('decision_engine', 'proposal_full', TRUE),
    ('decision_engine', 'proposal_section', TRUE),
    ('decision_engine', 'sales_letter_full', TRUE),
    ('decision_engine', 'sales_letter_section', TRUE),
    ('decision_engine', 'fragility_ai_interpretation', TRUE),
    ('decision_engine', 'scenario_simulation', TRUE),
    ('decision_engine', 'scenario_deterministic', TRUE),
    ('decision_engine', 'scenario_multi_compare_deterministic', TRUE),
    ('decision_engine', 'sensitivity_deterministic', TRUE),
    ('decision_engine', 'breakpoint_deterministic', TRUE),
    ('decision_engine', 'safe_zone_deterministic', TRUE),
    ('decision_engine', 'scenario_ai_interpretation', TRUE),
    ('decision_engine', 'scenario_ai_recommendation', TRUE),
    ('decision_engine', 'scenario_comparison_ai_summary', TRUE),
    ('decision_engine', 'sensitivity_ai_interpretation', TRUE),
    ('decision_engine', 'live_plan_kpi_refresh', TRUE),
    ('decision_engine', 'live_plan_variance', TRUE),
    ('decision_engine', 'live_plan_scenario_adopt', TRUE),
    ('decision_engine', 'live_plan_import_extract', TRUE),
    ('decision_engine', 'live_plan_section_refresh', TRUE),
    ('decision_engine', 'live_plan_variance_interpretation', TRUE),
    ('decision_engine', 'decision_ai_summary', TRUE),
    ('decision_engine', 'decision_narrative_update', TRUE),
    ('decision_engine', 'live_plan_full_refresh', TRUE),
    ('decision_engine', 'live_plan_monthly_review', TRUE),
    ('decision_engine', 'integration_sync', TRUE),
    ('decision_engine', 'integration_ai_insight', TRUE),
    ('decision_engine', 'engine_recalculation', TRUE)
ON CONFLICT (plan_code, feature_code) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    updated_at = NOW();
