begin;
-- Counts and filters apply to the entire index, before pagination.
create or replace function public.fts_discover(
 p_query text, p_stage text, p_limit integer, p_offset integer,
 p_industry text default '', p_location text default '', p_category text default '',
 p_deadline_from date default null, p_deadline_to date default null
) returns jsonb language sql stable set search_path = '' as $$
 with filtered as materialized (
 select l.* from public.fts_listings l
 where coalesce(l.details->>'title','') <> ''
 and (p_query = '' or l.search_text @@ plainto_tsquery('simple'::regconfig, p_query))
 and (p_stage = 'all' or p_stage = case when l.stage = 'open' and l.deadline <= now() then 'closed' else l.stage end)
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
revoke all on function public.fts_discover(text,text,integer,integer,text,text,text,date,date) from public,anon,authenticated;
grant execute on function public.fts_discover(text,text,integer,integer,text,text,text,date,date) to service_role;
-- Populate classification metadata for notices imported before item-level CPVs were read.
with source as (
 select distinct on (l.id) l.id,
 coalesce(h.payload->'tender'->'classification',h.payload->'tender'->'items'->0->'classification') as classification
 from public.fts_listings l join public.fts_release_history h
 on h.notice_id=l.notice_id and h.ocid=l.ocid
 where coalesce(l.details->>'cpv','')='' and h.rejection is null
 order by l.id,h.observed_at desc
)
update public.fts_listings l set details=l.details || jsonb_strip_nulls(jsonb_build_object(
 'cpv',s.classification->>'id','industry',s.classification->>'description'))
from source s where s.id=l.id and s.classification->>'id' is not null;
commit;
