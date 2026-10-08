-- Every Agent task has a price. A task whose steps have no price of their own (a record added,
-- a checklist prepared) is charged the task price once, when it has succeeded.
INSERT INTO credit_feature_config (
    feature_code, feature_name, credit_cost, enabled,
    minimum_plan, refundable_on_failure, credit_controlled
)
VALUES ('agent_task', 'Agent: task', 2, TRUE, 'explorer', TRUE, TRUE)
ON CONFLICT (feature_code) DO NOTHING;

-- No Agent step is free or below the 2 credit minimum (a scenario was being run for nothing).
UPDATE credit_feature_config
SET credit_cost = 2
WHERE feature_code LIKE 'agent\_%' AND credit_cost < 2;
