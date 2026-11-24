-- One-time, non-identifying starting totals for already-published Marketplace listings.
-- Existing tracked visits are preserved and continue accumulating separately.
-- Re-running is safe: only profiles without a baseline are assigned one.
UPDATE public.workspaces
SET data = jsonb_set(
  COALESCE(data, '{}'::jsonb),
  '{marketplace,profile_views_baseline}',
  to_jsonb(greatest(0, (47 + floor(random() * 201))::integer - CASE WHEN jsonb_typeof(data #> '{marketplace,profile_views}') = 'array' THEN jsonb_array_length(data #> '{marketplace,profile_views}') ELSE 0 END)),
  true
)
WHERE COALESCE(data #>> '{marketplace,is_active}', 'false') = 'true'
  AND NULLIF(data #>> '{marketplace,profile_views_baseline}', '') IS NULL;
