-- A person's first name, how they came, and when they were last here.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source TEXT;          -- homepage_agent | start_goal | direct_signup | marketplace_rfq
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_goal TEXT;             -- the first goal or task asked for
-- (Marketing permission is already on the account: marketing_email_status and its dates, from the activation emails migration.)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;    -- set when the dashboard is left, or after a minute on it

-- What a superadmin did with people's details (an export of contacts, for one).
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_email TEXT NOT NULL,
    action      TEXT NOT NULL,
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at ON admin_audit_log (created_at DESC);
