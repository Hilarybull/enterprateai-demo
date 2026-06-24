-- Migration: Add AI Narration and Research fields to idea_validation_results
-- Run this in your Supabase SQL Editor

ALTER TABLE idea_validation_results
ADD COLUMN IF NOT EXISTS service_name TEXT,
ADD COLUMN IF NOT EXISTS market_research JSONB,
ADD COLUMN IF NOT EXISTS market_fit JSONB,
ADD COLUMN IF NOT EXISTS research_data JSONB;

COMMENT ON COLUMN idea_validation_results.market_research IS 'Full AI narration report from Claude/OpenAI';
COMMENT ON COLUMN idea_validation_results.market_fit IS 'Deterministic market fit signals (trends, survival, competition)';
COMMENT ON COLUMN idea_validation_results.research_data IS 'Raw research evidence and search snippets used for analysis';
