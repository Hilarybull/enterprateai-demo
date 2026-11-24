INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure, credit_controlled)
VALUES ('tender_evaluation', 'Tender Evaluation', 20, TRUE, 'starter_insight', TRUE, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET credit_cost = 20;
