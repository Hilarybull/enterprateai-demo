-- Migration 014: Comprehensive idea validation credit cost (10 credits vs 5 for basic)
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES ('idea_validation_comprehensive', 'Idea Validation (Comprehensive)', 10, TRUE, 'explorer', TRUE)
ON CONFLICT (feature_code) DO NOTHING;
