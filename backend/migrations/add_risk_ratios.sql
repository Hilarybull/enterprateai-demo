-- Migration: Add Risk Enhancement Ratios to scenario_timelines
-- Purpose: Support professional-grade management accounting signals for simulation runs.

ALTER TABLE scenario_timelines
ADD COLUMN IF NOT EXISTS cash_conversion_ratio FLOAT DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS receivable_exposure_ratio FLOAT DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS delayed_revenue_pct FLOAT DEFAULT 0.0;

-- Optional: Add comments for clarity in Supabase UI
COMMENT ON COLUMN scenario_timelines.cash_conversion_ratio IS 'Cash Balance / Cumulative Profit';
COMMENT ON COLUMN scenario_timelines.receivable_exposure_ratio IS 'Accruals Outstanding / Cash Balance';
COMMENT ON COLUMN scenario_timelines.delayed_revenue_pct IS 'Accruals Outstanding / Cumulative Profit';
