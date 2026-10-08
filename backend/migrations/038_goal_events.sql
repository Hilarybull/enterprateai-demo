-- Goal-driven onboarding analytics (PRD-GO-001 s20): one row per funnel step.
-- Holds the step's name, the goal or task key, the entry mode and the capability it resolved
-- to. It has no column for what a visitor typed, their answers, their email or their business,
-- and the session reference is a prefix that cannot be used to open the session.
-- Until this is run, the events are written to the server log only.
CREATE TABLE IF NOT EXISTS goal_events (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             TEXT NOT NULL,
    session_id       TEXT,
    entry_mode       TEXT,
    goal_key         TEXT,
    capability       TEXT,
    resolution_class TEXT,
    signed_in        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goal_events_name_time_idx ON goal_events (name, created_at);
CREATE INDEX IF NOT EXISTS goal_events_session_idx ON goal_events (session_id);
ALTER TABLE goal_events ENABLE ROW LEVEL SECURITY;      -- reached only through the API (service role)
