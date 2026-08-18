-- Migration 015: Update AI Field Suggestion to 2 credits
-- Keep existing databases in sync with the product pricing expectation.

UPDATE credit_feature_config
SET credit_cost = 2
WHERE feature_code = 'suggest_field';

INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES ('suggest_field', 'AI Field Suggestion', 2, TRUE, 'explorer', FALSE)
ON CONFLICT (feature_code) DO NOTHING;
