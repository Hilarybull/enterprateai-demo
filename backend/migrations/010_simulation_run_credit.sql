-- Migration 010: Simulation scenario run credit cost
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure)
VALUES ('simulation_run', 'Simulation Scenario Run', 3, TRUE, 'explorer', FALSE)
ON CONFLICT (feature_code) DO NOTHING;
