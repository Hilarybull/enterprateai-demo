begin;

-- Find a Tender release history, current listing projection and sync checkpoint.
create table if not exists public.fts_release_history (
    version_id text primary key,
    notice_id text,
    ocid text,
    observed_at timestamptz not null default now(),
    rejection text,
    payload jsonb not null
);
create table if not exists public.fts_listings (
    id text primary key,
    ocid text not null,
    notice_id text not null,
    published_at timestamptz not null,
    observed_at timestamptz not null default now(),
    stage text not null check (stage in ('open', 'planning', 'award', 'closed', 'other')),
    deadline timestamptz,
    details jsonb not null,
    search_text tsvector generated always as (
      to_tsvector('simple'::regconfig, coalesce(details->>'title','') || ' ' ||
        coalesce(details->>'buyer','') || ' ' || coalesce(details->>'description','') || ' ' ||
        coalesce(details->>'category','') || ' ' || coalesce(details->>'cpv','') || ' ' ||
        coalesce(details->>'region','') || ' ' || notice_id)
    ) stored
);
create index if not exists fts_listings_search on public.fts_listings using gin (search_text);
create index if not exists fts_listings_stage_date on public.fts_listings (stage, published_at desc);
create index if not exists fts_listings_ocid on public.fts_listings (ocid);
create table if not exists public.fts_sync (
    id text primary key check (id = 'find-a-tender'),
    checkpoint timestamptz,
    last_success timestamptz,
    last_attempt timestamptz,
    retry_at timestamptz,
    lease_until timestamptz,
    lease_id uuid,
    error text,
    summary jsonb
);
insert into public.fts_sync(id) values ('find-a-tender') on conflict do nothing;

alter table public.fts_release_history enable row level security;
alter table public.fts_listings enable row level security;
alter table public.fts_sync enable row level security;
revoke all on public.fts_release_history, public.fts_listings, public.fts_sync from anon, authenticated;
grant select, insert, update on public.fts_release_history, public.fts_listings, public.fts_sync to service_role;

create or replace function public.fts_apply_page(p_lease uuid, p_rows jsonb)
returns integer language plpgsql set search_path = '' as $$
declare
    r jsonb;
    listing jsonb;
    imported integer := 0;
begin
    perform 1 from public.fts_sync
      where id = 'find-a-tender' and lease_id = p_lease and lease_until > now() for update;
    if not found then raise exception 'Find a Tender sync lease expired'; end if;
    for r in select value from jsonb_array_elements(p_rows) loop
        insert into public.fts_release_history(version_id, notice_id, ocid, rejection, payload)
        values (r->>'version_id', r->>'notice_id', r->>'ocid', r->>'rejection', r->'payload')
        on conflict do nothing;
        if not found then continue; end if;
        if r->>'rejection' is not null then continue; end if;
        imported := imported + 1;
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
                  (public.fts_listings.published_at, public.fts_listings.notice_id);
        end loop;
    end loop;
    return imported;
end;
$$;

create or replace function public.fts_search(p_query text, p_stage text, p_limit integer, p_offset integer)
returns setof public.fts_listings language sql stable set search_path = '' as $$
    select l.* from public.fts_listings l
    where coalesce(l.details->>'title','') <> ''
      and (p_query = '' or l.search_text @@ plainto_tsquery('simple'::regconfig, p_query))
      and (p_stage = 'all' or p_stage = case when l.stage = 'open' and l.deadline <= now() then 'closed' else l.stage end)
    order by l.published_at desc, l.id limit least(p_limit, 51) offset greatest(p_offset, 0);
$$;
revoke all on function public.fts_apply_page(uuid, jsonb), public.fts_search(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.fts_apply_page(uuid, jsonb), public.fts_search(text, text, integer, integer) to service_role;

create or replace function public.fts_acquire(p_lease uuid, p_now timestamptz, p_manual boolean)
returns setof public.fts_sync language sql set search_path = '' as $$
    update public.fts_sync s set lease_id = p_lease, lease_until = p_now + interval '20 minutes',
      last_attempt = p_now, checkpoint = coalesce(s.checkpoint, p_now - interval '7 days')
    where s.id = 'find-a-tender'
      and (s.lease_until is null or s.lease_until <= p_now)
      and (s.retry_at is null or s.retry_at <= p_now)
      and (p_manual or s.last_success is null or s.last_success <= p_now - interval '3 hours'
           or s.checkpoint < p_now - interval '4 hours')
    returning s.*;
$$;
revoke all on function public.fts_acquire(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.fts_acquire(uuid, timestamptz, boolean) to service_role;

create table if not exists public.fts_watchlist (
    workspace_id text not null,
    user_id text not null,
    listing_id text not null references public.fts_listings(id) on delete cascade,
    saved_at timestamptz not null default now(),
    primary key (workspace_id, user_id, listing_id)
);
alter table public.fts_watchlist enable row level security;
revoke all on public.fts_watchlist from anon, authenticated;
grant select, insert, delete, update on public.fts_watchlist to service_role;

commit;
