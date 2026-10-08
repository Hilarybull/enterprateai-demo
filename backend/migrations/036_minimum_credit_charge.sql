-- The smallest charge on the system is 2 credits. Every price that was 1 becomes 2; free (0)
-- stays free, and anything already 2 or more is left as it is. The application applies the same
-- minimum when it reads a price, so this only brings the stored price list into line with it.
UPDATE credit_feature_config
SET credit_cost = 2
WHERE credit_cost = 1;
