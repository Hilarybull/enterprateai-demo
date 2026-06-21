-- =============================================================================
-- Scenario Intelligence Module: Full Schema Migration
-- Run against your Supabase project: Settings → SQL Editor
--
-- This script is IDEMPOTENT — safe to run multiple times.
-- It creates tables if they don't exist and adds missing columns if the
-- tables already exist (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
--
-- Covers:
--   1. scenario_risk_signals
--   2. scenario_runs
--   3. scenario_timelines          ← NEW columns added (accounting update)
--   4. scenario_recommendations
--   5. scenario_decisions
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. scenario_risk_signals
-- Stores detected risk signals for each business state snapshot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_risk_signals (
    risk_signal_id          TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    business_id             TEXT NOT NULL,
    state_version           TEXT,
    risk_type               TEXT NOT NULL,
    severity                TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    metric_name             TEXT NOT NULL,
    metric_value            NUMERIC,
    threshold_value         NUMERIC,
    reason_code             TEXT NOT NULL,
    detected_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_srisk_tenant_biz
    ON scenario_risk_signals (tenant_id, business_id);


-- ---------------------------------------------------------------------------
-- 2. scenario_runs
-- Master record for each scenario simulation run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_runs (
    scenario_run_id         TEXT PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    business_id             TEXT NOT NULL,
    state_version           TEXT,
    scenario_template_id    TEXT NOT NULL,
    scenario_mode           TEXT NOT NULL CHECK (scenario_mode IN ('adaptive', 'manual')),
    scenario_name           TEXT NOT NULL,
    scenario_type           TEXT NOT NULL,
    parameters              JSONB DEFAULT '{}',
    baseline_snapshot       JSONB,
    scenario_snapshot       JSONB,
    engine_version          TEXT,
    status                  TEXT NOT NULL DEFAULT 'completed'
                                CHECK (status IN ('pending', 'completed', 'failed')),
    timeline_months         INTEGER NOT NULL DEFAULT 6,
    created_by_user_id      TEXT,
    started_at              TIMESTAMP WITH TIME ZONE,
    completed_at            TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    baseline_metrics        JSONB DEFAULT '{}',
    scenario_metrics        JSONB DEFAULT '{}',
    deltas                  JSONB DEFAULT '{}',
    state_result            TEXT CHECK (state_result IN ('improved', 'neutral', 'worse')),
    multi_engine            JSONB
);

CREATE INDEX IF NOT EXISTS idx_sruns_tenant_biz
    ON scenario_runs (tenant_id, business_id);
CREATE INDEX IF NOT EXISTS idx_sruns_created_at
    ON scenario_runs (created_at DESC);


-- ---------------------------------------------------------------------------
-- 3. scenario_timelines
-- Month-by-month projection rows for each scenario run.
-- Includes the new accounting-correct columns added in the June 2026 update.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_timelines (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_run_id         TEXT NOT NULL REFERENCES scenario_runs (scenario_run_id) ON DELETE CASCADE,
    month_index             INTEGER NOT NULL,

    -- Accruals-basis P&L columns
    revenue                 NUMERIC(15, 2) NOT NULL DEFAULT 0,
    accruals                NUMERIC(15, 2) NOT NULL DEFAULT 0,
    expenses                NUMERIC(15, 2) NOT NULL DEFAULT 0,
    cost_of_sales           NUMERIC(15, 2) NOT NULL DEFAULT 0,
    gross_profit            NUMERIC(15, 2) NOT NULL DEFAULT 0,
    gross_margin_pct        NUMERIC(8,  2) NOT NULL DEFAULT 0,
    costs                   NUMERIC(15, 2) NOT NULL DEFAULT 0,
    profit                  NUMERIC(15, 2) NOT NULL DEFAULT 0,
    cumulative_profit       NUMERIC(15, 2) NOT NULL DEFAULT 0,

    -- Cash-basis columns
    cash_balance            NUMERIC(15, 2) NOT NULL DEFAULT 0,   -- allows negative (overdraft)
    cash_runway_months      NUMERIC(8,  2),                      -- NULL when not burning

    -- Health signals
    stability_score         NUMERIC(6,  2) NOT NULL DEFAULT 0,
    state_label             TEXT NOT NULL DEFAULT 'tight'
                                CHECK (state_label IN ('stable', 'tight', 'at_risk', 'stress', 'critical')),

    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stimelines_run_month
    ON scenario_timelines (scenario_run_id, month_index);


-- ---------------------------------------------------------------------------
-- ADD MISSING COLUMNS — safe upgrade path for existing scenario_timelines rows
-- These ADD IF NOT EXISTS statements ensure that if the table already exists
-- from an earlier version of the service, the new columns are added cleanly.
-- ---------------------------------------------------------------------------

ALTER TABLE scenario_timelines
    ADD COLUMN IF NOT EXISTS gross_profit       NUMERIC(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE scenario_timelines
    ADD COLUMN IF NOT EXISTS gross_margin_pct   NUMERIC(8, 2)  NOT NULL DEFAULT 0;

ALTER TABLE scenario_timelines
    ADD COLUMN IF NOT EXISTS cumulative_profit  NUMERIC(15, 2) NOT NULL DEFAULT 0;

ALTER TABLE scenario_timelines
    ADD COLUMN IF NOT EXISTS cash_runway_months NUMERIC(8, 2);


-- ---------------------------------------------------------------------------
-- UPDATE state_label CHECK CONSTRAINT
-- Drop the old 3-state constraint and replace with the new 5-state version.
-- The constraint name may differ depending on when the table was first created,
-- so we drop by searching pg_constraint and recreate.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    con_name TEXT;
BEGIN
    -- Find any existing CHECK constraint on scenario_timelines.state_label
    SELECT conname INTO con_name
    FROM   pg_constraint c
    JOIN   pg_class      t ON t.oid = c.conrelid
    WHERE  t.relname = 'scenario_timelines'
    AND    c.contype = 'c'
    AND    pg_get_constraintdef(c.oid) LIKE '%state_label%'
    LIMIT  1;

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE scenario_timelines DROP CONSTRAINT IF EXISTS %I', con_name);
    END IF;
END $$;

ALTER TABLE scenario_timelines
    ADD CONSTRAINT chk_scenario_timelines_state_label
    CHECK (state_label IN ('stable', 'tight', 'at_risk', 'stress', 'critical'));


-- ---------------------------------------------------------------------------
-- 4. scenario_recommendations
-- Post-run follow-up recommendations stored per scenario run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_recommendations (
    recommendation_id       TEXT PRIMARY KEY,
    scenario_run_id         TEXT NOT NULL REFERENCES scenario_runs (scenario_run_id) ON DELETE CASCADE,
    action_type             TEXT NOT NULL,
    title                   TEXT NOT NULL,
    description             TEXT,
    scenario_template_id    TEXT,
    priority                INTEGER NOT NULL DEFAULT 1,
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_srecs_run_id
    ON scenario_recommendations (scenario_run_id);


-- ---------------------------------------------------------------------------
-- 5. scenario_decisions
-- Tracks the user's accept / reject / defer decision on each scenario run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scenario_decisions (
    decision_memory_id          TEXT PRIMARY KEY,
    tenant_id                   TEXT NOT NULL,
    business_id                 TEXT NOT NULL,
    scenario_run_id             TEXT NOT NULL REFERENCES scenario_runs (scenario_run_id) ON DELETE CASCADE,
    selected_recommendation_id  TEXT,
    decision_status             TEXT NOT NULL
                                    CHECK (decision_status IN ('accepted', 'rejected', 'deferred')),
    notes                       TEXT,
    outcome_status              TEXT,   -- reserved for future outcome tracking
    reviewed_at                 TIMESTAMP WITH TIME ZONE,
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sdec_tenant_biz
    ON scenario_decisions (tenant_id, business_id);
CREATE INDEX IF NOT EXISTS idx_sdec_run_id
    ON scenario_decisions (scenario_run_id);


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
