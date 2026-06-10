-- EnterprateAI Report & Narrative Tables
-- Run against your Supabase project: Settings → SQL Editor

-- -------------------------------------------------------------------------
-- reports
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL,
    tenant_id       TEXT,
    report_type     VARCHAR(100) NOT NULL,
    title           VARCHAR(255) NOT NULL,
    status          VARCHAR(50) DEFAULT 'generating',
    source_assessment_id      UUID,
    source_simulation_run_id  UUID,
    file_url        TEXT,
    generated_by    UUID,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_reports_business_id ON reports (business_id);
CREATE INDEX IF NOT EXISTS idx_reports_tenant_id   ON reports (tenant_id);

-- -------------------------------------------------------------------------
-- report_sections
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_sections (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id      UUID REFERENCES reports(id) ON DELETE CASCADE,
    section_key    VARCHAR(100) NOT NULL,
    section_title  VARCHAR(255) NOT NULL,
    content_text   TEXT,
    data_source    VARCHAR(50),
    section_order  INTEGER DEFAULT 0,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_sections_report_id ON report_sections (report_id);

-- -------------------------------------------------------------------------
-- ai_narratives
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_narratives (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID NOT NULL,
    tenant_id              TEXT,
    source_type            VARCHAR(50) NOT NULL,
    source_id              UUID,
    narrative_type         VARCHAR(100) NOT NULL,
    prompt_version         VARCHAR(50),
    model_name             VARCHAR(100),
    input_context_snapshot JSONB,
    generated_text         TEXT,
    validation_status      VARCHAR(50),
    confidence_level       VARCHAR(20),
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_narratives_business_id ON ai_narratives (business_id);
