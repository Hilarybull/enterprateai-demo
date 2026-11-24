-- Migration 044: the AI Business Plan on every plan, paid for in credits (the owner, 31 Oct 2026: "business plan, idea
-- validation is free depending on the credits"). Its price stays 40 credits; only the plan it starts on changes.
UPDATE credit_feature_config
SET minimum_plan = 'explorer'
WHERE feature_code = 'business_plan_full';

-- The idea page's Research & Prepare, priced on its own and on every plan (the owner, 31 Oct): up to 25 credits, charged only
-- for what it finds. The Comprehensive Idea Validation stays on paid plans.
INSERT INTO credit_feature_config (feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure, credit_controlled)
VALUES ('research_idea', 'Idea research', 25, TRUE, 'explorer', TRUE, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET minimum_plan = 'explorer';

-- The Basic Idea Validation costs 25 credits, on every plan; the Comprehensive one stays on paid plans (the owner, 31 Oct:
-- "the basic one costs 25 credits… free Explorer can access it and can't access the comprehensive").
UPDATE credit_feature_config
SET credit_cost = 25, credit_controlled = TRUE, minimum_plan = 'explorer'
WHERE feature_code = 'idea_validation';
