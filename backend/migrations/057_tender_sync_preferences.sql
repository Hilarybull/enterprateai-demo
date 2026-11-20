begin;

alter table public.fts_sync add column if not exists interval_minutes integer not null default 180
    check (interval_minutes between 5 and 1440);
alter table public.fts_sync add column if not exists import_scope text not null default 'suitable'
    check (import_scope in ('suitable', 'all'));
-- Snapshot scope per run so settings changes apply to the next sync.
alter table public.fts_sync add column if not exists active_import_scope text not null default 'suitable';

create or replace function public.fts_apply_page(p_lease uuid, p_rows jsonb)
returns integer language plpgsql set search_path = '' as $$
declare
    r jsonb;
    listing jsonb;
    imported integer := 0;
    scope text;
    fresh boolean;
begin
    select active_import_scope into scope from public.fts_sync
      where id = 'find-a-tender' and lease_id = p_lease and lease_until > now() for update;
    if not found then raise exception 'Find a Tender sync lease expired'; end if;
    for r in select value from jsonb_array_elements(p_rows) loop
        insert into public.fts_release_history(version_id, notice_id, ocid, rejection, payload)
        values (r->>'version_id', r->>'notice_id', r->>'ocid', r->>'rejection', r->'payload')
        on conflict do nothing;
        fresh := found;
        if r->>'rejection' is not null then continue; end if;
        if fresh then imported := imported + 1; end if;
        for listing in select value from jsonb_array_elements(r->'listings') loop
            if coalesce((listing->>'whole_process_closed')::boolean, false) then
                update public.fts_listings l set stage = 'closed', notice_id = r->>'notice_id',
                    observed_at = now(), published_at = (listing->>'published_at')::timestamptz
                where l.ocid = r->>'ocid' and l.stage = 'open'
                  and l.published_at <= (listing->>'published_at')::timestamptz;
            end if;
            if listing->>'stage' = 'open' and exists (
                select 1 from public.fts_listings l where l.ocid = r->>'ocid'
                  and l.details->>'whole_process_closed' = 'true'
                  and l.published_at >= (listing->>'published_at')::timestamptz
            ) then continue; end if;
            -- Filter new listings using the buyer's flag, but keep updates to existing tenders.
            -- Closure markers are retained even without SME suitability to prevent stale reopening.
            if scope = 'suitable'
               and coalesce(listing->'details'->>'sme_suitable', 'false') <> 'true'
               and not coalesce((listing->>'whole_process_closed')::boolean, false)
               and not exists (select 1 from public.fts_listings l where l.id = listing->>'id')
            then continue; end if;
            insert into public.fts_listings(id, ocid, notice_id, published_at, stage, deadline, details)
            values (listing->>'id', r->>'ocid', r->>'notice_id', (listing->>'published_at')::timestamptz,
                    listing->>'stage', (listing->>'deadline')::timestamptz,
                    listing->'details' || jsonb_build_object('whole_process_closed', listing->'whole_process_closed'))
            on conflict (id) do update set
                notice_id = excluded.notice_id, observed_at = now(), published_at = excluded.published_at,
                stage = excluded.stage, deadline = case when excluded.stage = 'open' then excluded.deadline
                     else coalesce(excluded.deadline, public.fts_listings.deadline) end,
                details = case when excluded.stage in ('closed', 'award') then
                  (public.fts_listings.details - 'amount' - 'currency') || jsonb_strip_nulls(excluded.details)
                  else excluded.details end
            where (excluded.published_at, excluded.notice_id) >=
                  (public.fts_listings.published_at, public.fts_listings.notice_id)
              and (excluded.notice_id, excluded.published_at, excluded.stage,
                   case when excluded.stage = 'open' then excluded.deadline
                        else coalesce(excluded.deadline, public.fts_listings.deadline) end,
                   case when excluded.stage in ('closed', 'award') then
                        (public.fts_listings.details - 'amount' - 'currency') || jsonb_strip_nulls(excluded.details)
                        else excluded.details end)
                  is distinct from
                  (public.fts_listings.notice_id, public.fts_listings.published_at, public.fts_listings.stage,
                   public.fts_listings.deadline, public.fts_listings.details);
        end loop;
    end loop;
    return imported;
end;
$$;


create or replace function public.fts_acquire(p_lease uuid, p_now timestamptz, p_manual boolean)
returns setof public.fts_sync language sql set search_path = '' as $$
    update public.fts_sync s set lease_id = p_lease, lease_until = p_now + interval '20 minutes',
      last_attempt = p_now, checkpoint = coalesce(s.checkpoint, p_now - interval '7 days'),
      active_import_scope = s.import_scope
    where s.id = 'find-a-tender'
      and (s.lease_until is null or s.lease_until <= p_now)
      and (s.retry_at is null or s.retry_at <= p_now)
      and (p_manual or s.last_attempt is null
           or s.last_attempt <= p_now - make_interval(mins => s.interval_minutes))
    returning s.*;
$$;
revoke all on function public.fts_acquire(uuid, timestamptz, boolean), public.fts_apply_page(uuid, jsonb)
    from public, anon, authenticated;
grant execute on function public.fts_acquire(uuid, timestamptz, boolean), public.fts_apply_page(uuid, jsonb)
    to service_role;

commit;
