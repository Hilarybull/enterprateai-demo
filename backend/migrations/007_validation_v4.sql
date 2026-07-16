-- Migration 007: Idea Validation Engine v4.0 Schema Updates
-- Adds engine_version tracking and stores V4 scores alongside legacy scores.
-- Run in Supabase SQL editor.

-- 1. Add engine_version to idea_validation_results (tracks which scoring engine was used)
ALTER TABLE idea_validation_results
  ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'v3';

-- 2. Add validation_mode (basic | comprehensive)
ALTER TABLE idea_validation_results
  ADD COLUMN IF NOT EXISTS validation_mode TEXT;

-- 3. Add V4-specific score columns
ALTER TABLE idea_validation_results
  ADD COLUMN IF NOT EXISTS potential_score DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS evidence_confidence_score DECIMAL(5,2);

-- 4. Add idea_type column (replaces legacy pathway for V4 results)
ALTER TABLE idea_validation_results
  ADD COLUMN IF NOT EXISTS idea_type TEXT;

-- 5. Backfill legacy rows with engine_version = 'v3'
UPDATE idea_validation_results
SET engine_version = 'v3'
WHERE engine_version IS NULL;

-- 6. Create index for plan-based filtering on V4 results
CREATE INDEX IF NOT EXISTS idx_validation_results_engine_version
  ON idea_validation_results(engine_version);

-- 7. Create index for validation_mode filtering
CREATE INDEX IF NOT EXISTS idx_validation_results_mode
  ON idea_validation_results(validation_mode);

-- Note: The V4 wizard saves full structured data to workspaces.data JSONB (existing column).
-- The idea_validation_results table stores summary scores; full V4 payload lives in research_data JSONB.
