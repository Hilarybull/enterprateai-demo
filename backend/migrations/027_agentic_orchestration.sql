-- ============================================================
-- Migration 027: Agentic Orchestration runtime (PRD-AO-001)
-- Workflow runs, steps, approvals, audit, idempotency, events,
-- enquiries, per-business policy, plan limits and credit features.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_workflow_runs (
    id                 UUID PRIMARY KEY,
    business_id        TEXT NOT NULL,
    requester_id       TEXT NOT NULL,
    requester_email    TEXT,
    workflow_key       TEXT NOT NULL,
    workflow_version   INTEGER NOT NULL,
    capability         TEXT NOT NULL,
    family             TEXT,
    title              TEXT,
    status             TEXT NOT NULL,       -- created | running | awaiting_approval | succeeded | failed | cancelled
    substatus          TEXT,                -- waiting_for_information | waiting_for_external_event | blocked | retry_available | delivery_status_uncertain
    reason_code        TEXT,
    goal               TEXT,
    source_channel     TEXT,                -- text | ui_action | business_event | api | voice
    source_reference   TEXT,
    request_id         TEXT,
    correlation_id     TEXT NOT NULL,
    recommendation_id  TEXT,
    state              JSONB NOT NULL DEFAULT '{}'::jsonb,
    budget             JSONB NOT NULL DEFAULT '{}'::jsonb,
    current_step       TEXT,
    seq                INTEGER NOT NULL DEFAULT 0,
    wake_at            TIMESTAMPTZ,
    summary            TEXT,
    next_action        TEXT,
    pending_question   JSONB,
    error              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_business ON agent_workflow_runs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status   ON agent_workflow_runs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_wake     ON agent_workflow_runs(wake_at) WHERE wake_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_step_runs (
    id               UUID PRIMARY KEY,
    run_id           UUID NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
    business_id      TEXT NOT NULL,
    seq              INTEGER NOT NULL,
    step_key         TEXT NOT NULL,
    title            TEXT,
    state            TEXT NOT NULL,         -- pending | running | awaiting_input | awaiting_approval | succeeded | failed | skipped | cancelled
    tool_id          TEXT,
    tool_version     INTEGER,
    input_ref        JSONB,
    output_ref       JSONB,
    idempotency_key  TEXT,
    external_ref     TEXT,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    reason_code      TEXT,
    error            TEXT,
    note             TEXT,
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_step_runs(run_id, seq);

CREATE TABLE IF NOT EXISTS agent_approvals (
    id               UUID PRIMARY KEY,
    run_id           UUID NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
    business_id      TEXT NOT NULL,
    step_key         TEXT NOT NULL,
    tool_id          TEXT NOT NULL,
    tool_version     INTEGER,
    title            TEXT,
    payload          JSONB NOT NULL,        -- the exact action being approved
    payload_hash     TEXT NOT NULL,
    payload_version  INTEGER NOT NULL DEFAULT 1,
    status           TEXT NOT NULL,         -- pending | approved | rejected | invalidated | expired | cancelled | consumed
    requester_id     TEXT,
    approver_id      TEXT,
    decided_at       TIMESTAMPTZ,
    decided_note     TEXT,
    expires_at       TIMESTAMPTZ,
    workflow_key     TEXT,
    capability       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_business ON agent_approvals(business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_run      ON agent_approvals(run_id);

CREATE TABLE IF NOT EXISTS agent_audit_events (
    id                UUID PRIMARY KEY,
    business_id       TEXT NOT NULL,
    run_id            UUID,
    actor_id          TEXT,
    event_type        TEXT NOT NULL,
    workflow_key      TEXT,
    workflow_version  INTEGER,
    source_channel    TEXT,
    source_reference  TEXT,
    correlation_id    TEXT,
    detail            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_run      ON agent_audit_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_audit_business ON agent_audit_events(business_id, created_at DESC);

-- One row per effectful action. The unique key is what makes retries and
-- duplicate events unable to create a second document, send or reminder.
CREATE TABLE IF NOT EXISTS agent_idempotency (
    id            UUID PRIMARY KEY,
    business_id   TEXT NOT NULL,
    key           TEXT NOT NULL,
    run_id        UUID,
    status        TEXT NOT NULL DEFAULT 'started',   -- started | completed
    result        JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ,
    UNIQUE (business_id, key)
);

CREATE TABLE IF NOT EXISTS agent_events (
    id              UUID PRIMARY KEY,
    business_id     TEXT NOT NULL,
    type            TEXT NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    run_id          UUID,
    correlation_id  TEXT,
    causation_id    TEXT,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_events_business ON agent_events(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_enquiries (
    id              UUID PRIMARY KEY,
    business_id     TEXT NOT NULL,
    source          TEXT,                  -- manual | user_request | api | email | website
    sender_name     TEXT,
    sender_email    TEXT,
    subject         TEXT,
    body            TEXT NOT NULL,         -- untrusted external content
    classification  TEXT,
    status          TEXT NOT NULL DEFAULT 'new',
    run_id          UUID,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_enquiries_business ON agent_enquiries(business_id, created_at DESC);

-- Versioned per-business Agent policy (contract route, VAT default, reminder
-- cadence, A4 pre-authorisation, who may approve).
CREATE TABLE IF NOT EXISTS agent_policies (
    business_id  TEXT PRIMARY KEY,
    policy       JSONB NOT NULL DEFAULT '{}'::jsonb,
    version      INTEGER NOT NULL DEFAULT 1,
    updated_by   TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Plan limits are data, so commercial decisions don't need a code release.
CREATE TABLE IF NOT EXISTS agent_plan_limits (
    plan_code        TEXT PRIMARY KEY,
    monthly_runs     INTEGER NOT NULL,
    max_active_runs  INTEGER NOT NULL,
    max_autonomy     TEXT NOT NULL,        -- A1 | A2 | A3 | A4
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO agent_plan_limits (plan_code, monthly_runs, max_active_runs, max_autonomy) VALUES
    ('explorer',              5,    2,   'A3'),
    ('starter_insight',       50,   10,  'A3'),
    ('decision_engine',       500,  50,  'A4'),
    ('growth_navigator',      2000, 200, 'A4'),
    ('strategic_business_os', 5000, 500, 'A4')
ON CONFLICT (plan_code) DO NOTHING;

-- Agent actions are metered through the existing AI Credit wallet. Open to
-- every plan (free users spend their 50 sign-up credits); costs are editable.
INSERT INTO credit_feature_config (
    feature_code, feature_name, credit_cost, enabled, minimum_plan, refundable_on_failure, credit_controlled
) VALUES
    ('agent_classify',       'Agent: classify enquiry',         1, TRUE, 'explorer', TRUE, TRUE),
    ('agent_quote_draft',    'Agent: prepare quotation',        2, TRUE, 'explorer', TRUE, TRUE),
    ('agent_contract_draft', 'Agent: prepare contract',         2, TRUE, 'explorer', TRUE, TRUE),
    ('agent_invoice_draft',  'Agent: prepare invoice',          2, TRUE, 'explorer', TRUE, TRUE),
    ('agent_send',           'Agent: send document',            1, TRUE, 'explorer', TRUE, TRUE),
    ('agent_reminder',       'Agent: payment reminder',         1, TRUE, 'explorer', TRUE, TRUE),
    ('agent_receipt',        'Agent: receipt',                  1, TRUE, 'explorer', TRUE, TRUE),
    ('agent_analyse',        'Agent: risk & scenario analysis', 1, TRUE, 'explorer', TRUE, TRUE)
ON CONFLICT (feature_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
