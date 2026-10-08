-- ============================================================
-- Migration 028: one Agent run per source reference (QA Q-1, PRD AC-12).
-- A repeated or concurrent request carrying the same source_reference for the
-- same business, capability and target must not create a second run (and so
-- can't produce a second quotation or use a second monthly task).
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE agent_workflow_runs
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- The constraint the idempotent insert relies on. Cancelled runs release their
-- key (set to NULL), so the same source can be started again after a cancel.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_dedupe
  ON agent_workflow_runs(business_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Lookups by source reference (the duplicate check before a run is created).
CREATE INDEX IF NOT EXISTS idx_agent_runs_source_ref
  ON agent_workflow_runs(business_id, capability, source_reference)
  WHERE source_reference IS NOT NULL;

NOTIFY pgrst, 'reload schema';
