begin;
-- Counts and filters apply to the entire index, before pagination.
create or replace function public.fts_discover_sme(
 p_query text, p_stage text, p_limit integer, p_offset integer,
 p_industry text default '', p_location text default '', p_category text default '',
 p_deadline_from date default null, p_deadline_to date default null, p_sme text default 'suitable'
) returns jsonb language sql stable set search_path = '' as $$
 with filtered as materialized (
 select l.* from public.fts_listings l
 where coalesce(l.details->>'title','') <> ''
 and (p_query = '' or l.search_text @@ plainto_tsquery('simple'::regconfig, p_query))
 and (p_stage = 'all' or p_stage = case when l.stage = 'open' and l.deadline <= now() then 'closed' else l.stage end)
 and (p_sme = 'all' or (p_sme = 'suitable' and l.details->'sme_suitable' = 'true'::jsonb)
      or (p_sme = 'unspecified' and (l.details->'sme_suitable' is null or l.details->'sme_suitable' = 'null'::jsonb)))
 and (p_industry = '' or left(l.details->>'cpv',2) = p_industry)
 and (p_category = '' or l.details->>'category' = p_category)
 and (p_location = '' or position(lower(p_location) in lower(coalesce(l.details->>'region',''))) > 0)
 and (p_deadline_from is null or l.deadline >= (p_deadline_from::timestamp at time zone 'Europe/London'))
 and (p_deadline_to is null or l.deadline < ((p_deadline_to + 1)::timestamp at time zone 'Europe/London'))
 ), page_rows as (
 select * from filtered order by published_at desc, id
 limit least(greatest(p_limit,1),50) offset greatest(p_offset,0)
 )
 select jsonb_build_object('total',(select count(*) from filtered),
 'items',coalesce((select jsonb_agg(to_jsonb(p) - 'search_text' order by p.published_at desc,p.id) from page_rows p),'[]'::jsonb));
$$;
revoke all on function public.fts_discover_sme(text,text,integer,integer,text,text,text,date,date,text) from public,anon,authenticated;
grant execute on function public.fts_discover_sme(text,text,integer,integer,text,text,text,date,date,text) to service_role;

-- Backfill from retained source data; an explicit lot value takes precedence over the tender value.
with source as (
 select distinct on (l.id) l.id,
 coalesce(lot.value->'suitability'->'sme', h.payload->'tender'->'suitability'->'sme') as sme
 from public.fts_listings l join public.fts_release_history h on h.notice_id=l.notice_id and h.ocid=l.ocid
 left join lateral jsonb_array_elements(case when jsonb_typeof(h.payload->'tender'->'lots')='array' then h.payload->'tender'->'lots' else '[]'::jsonb end) lot(value)
 on lot.value->>'id'=l.details->>'lot_id'
 where h.rejection is null
 order by l.id,h.observed_at desc
)
update public.fts_listings l set details=l.details || jsonb_build_object('sme_suitable',
 case when jsonb_typeof(s.sme)='boolean' then s.sme else 'null'::jsonb end)
from source s where s.id=l.id;
commit;
