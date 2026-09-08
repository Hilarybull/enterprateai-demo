-- ============================================================
-- Migration 019: Proposal System
-- Two-sided proposal marketplace: recipients publish structured
-- requests, proposers submit structured proposals, and the whole
-- lifecycle is tracked in a single audit trail per proposal.
--
-- Dedicated tables (not the workspace.data JSONB blob): the backend
-- runs on the Supabase service-role key, so cross-workspace writes
-- need no RLS-bypass helper and a status change is one atomic UPDATE.
--
-- The `proposal_section` credit feature is already seeded by
-- migration 016 (cost 2, minimum_plan starter_insight) — no change here.
-- ============================================================

-- ── Preferences: one row per workspace, controls opt-in to receiving ──────────
CREATE TABLE IF NOT EXISTS proposal_preferences (
    workspace_id         TEXT PRIMARY KEY,
    user_id              TEXT NOT NULL,
    enabled              BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_modes       JSONB NOT NULL DEFAULT '["general"]'::jsonb,
    accepted_categories  JSONB,                       -- null = accept all
    proposal_cap         INTEGER,                     -- null = unlimited concurrent proposals
    visibility           TEXT NOT NULL DEFAULT 'marketplace',   -- marketplace | private
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_preferences_user_id
    ON proposal_preferences (user_id);

-- ── Requests: structured briefs a recipient publishes ────────────────────────
CREATE TABLE IF NOT EXISTS proposal_requests (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id         TEXT NOT NULL,               -- owning (recipient) workspace
    user_id              TEXT NOT NULL,               -- owning user
    company_name         TEXT,                        -- cached recipient company name
    type                 TEXT NOT NULL DEFAULT 'general',
    title                TEXT NOT NULL,
    description          TEXT,
    budget_range         TEXT,
    budget_currency      TEXT,
    budget_visible       BOOLEAN NOT NULL DEFAULT FALSE,
    deadline             DATE,                        -- submissions rejected after this date
    submission_cap       INTEGER,                     -- null = unlimited
    requirements         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{id,text,mandatory,weight}]
    accepted_modes       JSONB NOT NULL DEFAULT '["general"]'::jsonb,
    accepted_categories  JSONB,
    visibility           TEXT NOT NULL DEFAULT 'marketplace',  -- marketplace | private
    status               TEXT NOT NULL DEFAULT 'DRAFT',        -- DRAFT | PUBLISHED | CLOSED
    submission_count     INTEGER NOT NULL DEFAULT 0,
    invited_emails       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- emails invited to apply
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_requests_workspace_id
    ON proposal_requests (workspace_id);
CREATE INDEX IF NOT EXISTS idx_proposal_requests_status
    ON proposal_requests (status);
CREATE INDEX IF NOT EXISTS idx_proposal_requests_visibility
    ON proposal_requests (visibility);

-- ── Proposals (submissions): one row = one proposer response ─────────────────
CREATE TABLE IF NOT EXISTS proposals (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id             UUID,                       -- null = unsolicited approach
    request_title          TEXT,                       -- cached at submission time
    proposer_workspace_id  TEXT NOT NULL,
    proposer_user_id       TEXT NOT NULL,
    proposer_name          TEXT NOT NULL,
    proposer_email         TEXT NOT NULL,
    recipient_workspace_id TEXT NOT NULL,
    recipient_user_id      TEXT,
    recipient_name         TEXT NOT NULL,
    title                  TEXT,
    summary                TEXT,                       -- cover letter / executive summary
    sections               JSONB,                      -- [{heading,content}]
    requirement_responses  JSONB,                      -- [{requirement_id,response}]
    attachments            JSONB,                      -- [{url,filename,mime,size}]
    events                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{status,timestamp,actor,reason}]
    status                 TEXT NOT NULL DEFAULT 'SUBMITTED',
    version                INTEGER NOT NULL DEFAULT 1,
    inbox_hidden           BOOLEAN NOT NULL DEFAULT FALSE,      -- recipient removed it from inbox view
    submitted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    viewed_at              TIMESTAMPTZ                          -- when recipient first opened it
);

CREATE INDEX IF NOT EXISTS idx_proposals_proposer_workspace_id
    ON proposals (proposer_workspace_id);
CREATE INDEX IF NOT EXISTS idx_proposals_recipient_workspace_id
    ON proposals (recipient_workspace_id);
CREATE INDEX IF NOT EXISTS idx_proposals_request_id
    ON proposals (request_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status
    ON proposals (status);

-- Make PostgREST (Supabase's REST layer) pick up the new tables immediately.
NOTIFY pgrst, 'reload schema';
