-- The assistant chat's entry in the price list. Migration 004 added it, but it is missing
-- from some databases, which made every chat answer fail with FEATURE_NOT_FOUND.
-- Adds it at the standard price if it isn't there; an existing row is left exactly as it is.
INSERT INTO credit_feature_config (
    feature_code, feature_name, credit_cost, enabled,
    minimum_plan, refundable_on_failure, credit_controlled
)
VALUES ('chat_message', 'Business Assistant Chat', 2, TRUE, 'explorer', TRUE, TRUE)
ON CONFLICT (feature_code) DO NOTHING;
