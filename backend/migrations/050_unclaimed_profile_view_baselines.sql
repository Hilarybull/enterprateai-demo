-- One-time starting view totals for all existing directory profiles.
-- Run after 049 in production. Published and invitation-only listings qualify,
-- whether claimed or unclaimed.
-- Existing measured visits and higher totals are preserved. No visit records are fabricated.
-- A marker on each counter makes reruns preserve previously assigned or edited totals.

BEGIN;

-- Serialize counter writes while existing counters are updated and missing ones are inserted.
LOCK TABLE public.marketplace_events IN SHARE ROW EXCLUSIVE MODE;

WITH targets AS MATERIALIZED (
  SELECT e.id, (47 + floor(random() * 201))::integer AS target_total
  FROM public.marketplace_events e
  JOIN public.marketplace_directory_profiles p ON p.id = e.subject_id
  WHERE e.business_id = 'marketplace'
    AND e.kind = 'profile_views'
    AND e.key = 'views:' || p.id::text
    AND p.data ->> 'publication' IN ('published', 'noindex')
    AND NOT (e.data ? 'profile_views_seeded_at')
)
UPDATE public.marketplace_events e
SET data = e.data || jsonb_build_object(
      'admin_added', greatest(
        COALESCE((e.data ->> 'admin_added')::integer, 0),
        targets.target_total - COALESCE((e.data ->> 'total')::integer, 0),
        0
      ),
      'profile_views_seeded_at', CURRENT_TIMESTAMP
    ),
    updated_at = CURRENT_TIMESTAMP
FROM targets
WHERE e.id = targets.id;

INSERT INTO public.marketplace_events (
  id, business_id, kind, subject_id, status, revision, key,
  data, created_by, created_at, updated_at
)
SELECT gen_random_uuid(), 'marketplace', 'profile_views', p.id, 'recorded', 1,
       'views:' || p.id::text,
       jsonb_build_object(
         'schema_version', 1,
         'correlation_id', 'views:' || p.id::text,
         'total', 0,
         'admin_added', (47 + floor(random() * 201))::integer,
         'profile_views_seeded_at', CURRENT_TIMESTAMP
       ),
       'migration:050', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM public.marketplace_directory_profiles p
WHERE p.data ->> 'publication' IN ('published', 'noindex')
  AND NOT EXISTS (
    SELECT 1
    FROM public.marketplace_events e
    WHERE e.business_id = 'marketplace'
      AND e.kind = 'profile_views'
      AND e.subject_id = p.id
      AND e.key = 'views:' || p.id::text
  );

COMMIT;
