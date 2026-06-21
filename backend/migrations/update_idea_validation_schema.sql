-- Idea Validation Module: Schema Updates
-- Run against your Supabase project: Settings → SQL Editor

-- -------------------------------------------------------------------------
-- idea_validation_results
-- Stories history of all evaluations performed by users.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idea_validation_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    pathway         VARCHAR(50) NOT NULL,
    business_name   VARCHAR(255),
    total_score     DECIMAL(5, 2) NOT NULL,
    confidence_score DECIMAL(5, 2) NOT NULL,
    scoring_details JSONB NOT NULL,
    metrics         JSONB NOT NULL,
    report_narration TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_iv_results_user_id ON idea_validation_results (user_id);
CREATE INDEX IF NOT EXISTS idx_iv_results_workspace_id ON idea_validation_results (workspace_id);

-- -------------------------------------------------------------------------
-- idea_validation_usage
-- Tracks daily validation requests to enforce limits.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS idea_validation_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    request_date    DATE DEFAULT CURRENT_DATE,
    request_count   INTEGER DEFAULT 1,
    last_request_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, request_date)
);

CREATE INDEX IF NOT EXISTS idx_iv_usage_user_date ON idea_validation_usage (user_id, request_date);

-- -------------------------------------------------------------------------
-- Optional: Ensure workspaces has the latest expected JSONB structure (informational only)
-- -------------------------------------------------------------------------
-- COMMENT ON COLUMN workspaces.data IS 'Stores IdeaValidationPayload {pathway, context, problem, offer, demand, costs, validation}';
