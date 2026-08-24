-- ============================================================
-- Migration 017: Live Business Plan Technical Specification
-- Versioned planned-state layer for approved future intent.
-- ============================================================

CREATE TABLE IF NOT EXISTS live_business_plans (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              TEXT NOT NULL,
    business_id          TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'DRAFT',
    current_version_id    UUID,
    source_document_id    UUID,
    adopted_at           TIMESTAMPTZ,
    created_by           TEXT,
    narrative_markdown   TEXT,
    narrative_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
    narrative_updated_at TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_live_business_plans_business_id
    ON live_business_plans (business_id);

CREATE INDEX IF NOT EXISTS idx_live_business_plans_status
    ON live_business_plans (status);

CREATE TABLE IF NOT EXISTS live_plan_versions (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id       UUID NOT NULL,
    version_number     INTEGER NOT NULL,
    previous_version_id UUID,
    source_type        TEXT NOT NULL,
    source_reference_id TEXT,
    change_summary     TEXT,
    approved_by        TEXT,
    approved_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (live_plan_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_live_plan_versions_live_plan_id
    ON live_plan_versions (live_plan_id);

CREATE INDEX IF NOT EXISTS idx_live_plan_versions_source_reference
    ON live_plan_versions (source_type, source_reference_id);

CREATE TABLE IF NOT EXISTS live_plan_assumptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id          UUID NOT NULL,
    live_plan_version_id   UUID NOT NULL,
    domain                TEXT NOT NULL,
    entity_type           TEXT,
    entity_id             TEXT,
    metric_code           TEXT NOT NULL,
    assumption_name       TEXT NOT NULL,
    assumption_value_json  JSONB,
    baseline_value_json    JSONB,
    target_value_json      JSONB,
    source_type           TEXT,
    source_reference_id   TEXT,
    confidence_score      NUMERIC(5,2),
    effective_from        TIMESTAMPTZ,
    effective_to          TIMESTAMPTZ,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (live_plan_version_id, metric_code, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_live_plan_assumptions_plan_version
    ON live_plan_assumptions (live_plan_id, live_plan_version_id);

CREATE INDEX IF NOT EXISTS idx_live_plan_assumptions_metric_code
    ON live_plan_assumptions (metric_code);

CREATE TABLE IF NOT EXISTS planned_entity_changes (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id          UUID NOT NULL,
    live_plan_version_id   UUID NOT NULL,
    domain                TEXT NOT NULL,
    entity_type           TEXT NOT NULL,
    entity_id             TEXT,
    operation             TEXT NOT NULL,
    field_name            TEXT,
    current_value_json     JSONB,
    planned_value_json     JSONB,
    effective_from         TIMESTAMPTZ,
    due_date              TIMESTAMPTZ,
    status                TEXT NOT NULL DEFAULT 'PLANNED',
    source_type           TEXT,
    source_reference_id   TEXT,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ,
    UNIQUE (live_plan_version_id, entity_type, entity_id, field_name, operation)
);

CREATE INDEX IF NOT EXISTS idx_planned_entity_changes_plan_version
    ON planned_entity_changes (live_plan_id, live_plan_version_id);

CREATE INDEX IF NOT EXISTS idx_planned_entity_changes_status
    ON planned_entity_changes (status);

CREATE TABLE IF NOT EXISTS plan_kpis (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id          UUID NOT NULL,
    live_plan_version_id   UUID NOT NULL,
    code                  TEXT NOT NULL,
    name                  TEXT NOT NULL,
    domain                TEXT NOT NULL,
    metric_path           TEXT,
    target_value_json     JSONB,
    tolerance_json        JSONB,
    actual_value_json     JSONB,
    unit                  TEXT,
    direction             TEXT NOT NULL DEFAULT 'up',
    status                TEXT NOT NULL DEFAULT 'PLANNED',
    last_observed_at      TIMESTAMPTZ,
    source_type           TEXT,
    source_reference_id   TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (live_plan_version_id, code)
);

CREATE INDEX IF NOT EXISTS idx_plan_kpis_plan_version
    ON plan_kpis (live_plan_id, live_plan_version_id);

CREATE INDEX IF NOT EXISTS idx_plan_kpis_code
    ON plan_kpis (code);

CREATE TABLE IF NOT EXISTS kpi_observations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id          UUID NOT NULL,
    live_plan_version_id   UUID NOT NULL,
    plan_kpi_id           UUID,
    code                  TEXT NOT NULL,
    observed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    value_json            JSONB NOT NULL,
    source_type           TEXT,
    source_reference_id   TEXT,
    confidence_score      NUMERIC(5,2),
    is_authoritative      BOOLEAN NOT NULL DEFAULT FALSE,
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_kpi_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_kpi_observations_plan_version
    ON kpi_observations (live_plan_id, live_plan_version_id);

CREATE INDEX IF NOT EXISTS idx_kpi_observations_code
    ON kpi_observations (code);

CREATE TABLE IF NOT EXISTS plan_variances (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id          UUID NOT NULL,
    live_plan_version_id   UUID NOT NULL,
    plan_kpi_id           UUID,
    code                  TEXT NOT NULL,
    observed_at           TIMESTAMPTZ,
    target_value_json     JSONB,
    actual_value_json     JSONB,
    variance_value_json   JSONB,
    variance_pct          NUMERIC(12,4),
    status                TEXT NOT NULL,
    severity              TEXT NOT NULL,
    narrative             TEXT,
    detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (live_plan_version_id, plan_kpi_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_plan_variances_plan_version
    ON plan_variances (live_plan_id, live_plan_version_id);

CREATE INDEX IF NOT EXISTS idx_plan_variances_status
    ON plan_variances (status);

CREATE TABLE IF NOT EXISTS live_plan_alerts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    live_plan_id          UUID NOT NULL,
    live_plan_version_id   UUID NOT NULL,
    plan_kpi_id           UUID,
    plan_variance_id      UUID,
    alert_type            TEXT NOT NULL,
    severity              TEXT NOT NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    status                TEXT NOT NULL DEFAULT 'OPEN',
    acknowledged_at       TIMESTAMPTZ,
    acknowledged_by       TEXT,
    dismissed_at          TIMESTAMPTZ,
    dismissed_by          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (live_plan_version_id, alert_type, plan_kpi_id, plan_variance_id)
);

CREATE INDEX IF NOT EXISTS idx_live_plan_alerts_plan_version
    ON live_plan_alerts (live_plan_id, live_plan_version_id);

CREATE INDEX IF NOT EXISTS idx_live_plan_alerts_status
    ON live_plan_alerts (status);

