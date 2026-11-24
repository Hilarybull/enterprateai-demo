-- Credit allocation v2 (15 Oct 2026): the owner's chart, one price for each capability.
-- Deterministic work stays free, and Basic idea validation is deterministic (Comprehensive is the paid one).
UPDATE credit_feature_config SET credit_cost = 0, credit_controlled = FALSE WHERE feature_code = 'idea_validation';
UPDATE credit_feature_config SET credit_cost = 25 WHERE feature_code = 'idea_validation_comprehensive';
UPDATE credit_feature_config SET credit_cost = 40 WHERE feature_code = 'business_plan_full';
UPDATE credit_feature_config SET credit_cost = 5 WHERE feature_code = 'business_plan_section';
UPDATE credit_feature_config SET credit_cost = 10 WHERE feature_code = 'proposal_full';
UPDATE credit_feature_config SET credit_cost = 4 WHERE feature_code = 'sales_letter_full';
UPDATE credit_feature_config SET credit_cost = 15 WHERE feature_code = 'scenario_ai_interpretation';
UPDATE credit_feature_config SET credit_cost = 20 WHERE feature_code = 'live_plan_full_refresh';
UPDATE credit_feature_config SET credit_cost = 2 WHERE feature_code = 'agent_task';

-- The premium research of each check: one price a run, charged only when it finds something with a checked source.
INSERT INTO credit_feature_config (
    feature_code, feature_name, credit_cost, enabled,
    minimum_plan, refundable_on_failure, credit_controlled
)
VALUES
    ('research_launch_blockers', 'Resolve launch blockers', 50, TRUE, 'starter_insight', TRUE, TRUE),
    ('research_funding_readiness', 'Funding readiness research', 60, TRUE, 'starter_insight', TRUE, TRUE),
    ('research_best_price', 'Find my best price', 40, TRUE, 'starter_insight', TRUE, TRUE),
    ('research_customer_opportunities', 'Find customer opportunities', 40, TRUE, 'starter_insight', TRUE, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET credit_cost = EXCLUDED.credit_cost, feature_name = EXCLUDED.feature_name;
