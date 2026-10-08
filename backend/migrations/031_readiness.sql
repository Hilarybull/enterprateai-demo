-- ============================================================
-- Migration 031: Funding Readiness and Launch Readiness.
--
-- The shared assessment service (Shared Architecture Blueprint v0.1): funding
-- cases and launch initiatives, the monthly forecast both can reference,
-- evidence, immutable assessment snapshots, follow-through actions, prepared
-- documents and launch decisions. Every row belongs to one business.
--
-- Additive only: nothing existing is changed. Rolling back is done with the
-- FUNDING_READINESS_ENABLED / LAUNCH_READINESS_ENABLED flags; drafts and
-- history stay in these tables. Safe to run multiple times.
-- ============================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['readiness_subjects', 'readiness_forecasts', 'readiness_evidence', 'readiness_assessments',
                           'readiness_actions', 'readiness_artifacts', 'readiness_decisions']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        id           UUID PRIMARY KEY,
        business_id  TEXT NOT NULL,
        kind         TEXT NOT NULL,
        subject_id   UUID,
        status       TEXT,
        revision     INTEGER NOT NULL DEFAULT 1,
        key          TEXT,
        data         JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )$f$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (business_id, created_at DESC)', 'idx_' || t || '_business', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (subject_id, created_at DESC)', 'idx_' || t || '_subject', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- One logical run or document per idempotency key, and one action per criterion or blocker,
-- even when two requests arrive at the same moment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_readiness_assessments_key ON readiness_assessments (business_id, subject_id, key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_readiness_artifacts_key   ON readiness_artifacts   (business_id, subject_id, key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_readiness_actions_key     ON readiness_actions     (business_id, subject_id, key) WHERE key IS NOT NULL;
-- The same evidence entered twice is one item (key = a fingerprint of title, source and date).
CREATE UNIQUE INDEX IF NOT EXISTS uq_readiness_evidence_key    ON readiness_evidence    (business_id, key) WHERE key IS NOT NULL;
