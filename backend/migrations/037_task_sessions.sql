-- Goal-driven onboarding (PRD-GO-001): a visitor's goal and the few answers given before sign-up.
-- Temporary by design: it holds no business, customer or document records, and an unfinished
-- session expires (7 days by default). Until this is run, sessions are kept in the server's
-- memory, which works but does not survive a restart.
CREATE TABLE IF NOT EXISTS task_sessions (
    id          TEXT PRIMARY KEY,
    state       TEXT NOT NULL,
    user_id     TEXT,
    business_id TEXT,
    data        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS task_sessions_expires_idx ON task_sessions (expires_at);
CREATE INDEX IF NOT EXISTS task_sessions_user_idx ON task_sessions (user_id);
ALTER TABLE task_sessions ENABLE ROW LEVEL SECURITY;      -- reached only through the API (service role)
