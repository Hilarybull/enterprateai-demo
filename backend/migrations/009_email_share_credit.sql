-- Migration 009: Email share credit cost
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES ('email_share', 'Email Share / Send', 1, TRUE, 'explorer', FALSE)
ON CONFLICT (feature_code) DO NOTHING;
