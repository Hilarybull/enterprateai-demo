-- Every model and search call the platform makes, for the superadmin's AI tracking (cost per feature, model and person).
-- The same table as in supabase_schema.sql; it had no numbered migration, so a database built from migrations lacked it
-- and every call went unrecorded. No foreign key on user_id: a call is still recorded when its user row is gone.
CREATE TABLE IF NOT EXISTS ai_usage_events (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            TEXT,
    feature            TEXT NOT NULL,
    provider           TEXT NOT NULL,
    model              TEXT NOT NULL,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    total_tokens       INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(12, 8),
    request_id         TEXT,
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_at_idx ON ai_usage_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_id_idx ON ai_usage_events (user_id);
CREATE INDEX IF NOT EXISTS ai_usage_events_feature_idx ON ai_usage_events (feature);

-- The Agent's credit charges are read by feature for the same page.
CREATE INDEX IF NOT EXISTS credit_transactions_feature_created_idx ON credit_transactions (feature_code, created_at DESC);
