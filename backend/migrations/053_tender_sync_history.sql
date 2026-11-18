begin;

alter table public.fts_sync add column if not exists error_dismissed_for timestamptz;

create table if not exists public.fts_sync_history (
    attempted_at timestamptz primary key,
    finished_at timestamptz,
    status text not null check (status in ('running', 'succeeded', 'failed', 'interrupted')),
    error text,
    summary jsonb
);

alter table public.fts_sync_history enable row level security;
revoke all on public.fts_sync_history from anon, authenticated;
grant select, insert, update on public.fts_sync_history to service_role;

insert into public.fts_sync_history (attempted_at, finished_at, status, error, summary)
select last_attempt,
       case when lease_id is null and error is null and last_success >= last_attempt then last_success end,
       case when lease_id is not null and lease_until > now() then 'running'
            when lease_id is not null then 'interrupted'
            when error is not null then 'failed'
            when last_success >= last_attempt then 'succeeded'
            else 'interrupted' end,
       case when lease_id is null then error end,
       case when lease_id is null and error is null and last_success >= last_attempt then summary end
from public.fts_sync where last_attempt is not null
on conflict do nothing;

create or replace function public.fts_record_sync_attempt()
returns trigger language plpgsql set search_path = '' as $$
begin
    if new.lease_id is not null and new.lease_id is distinct from old.lease_id then
        update public.fts_sync_history set status = 'interrupted', finished_at = now()
        where attempted_at = old.last_attempt and status = 'running';
        insert into public.fts_sync_history (attempted_at, status)
        values (new.last_attempt, 'running');
    elsif old.lease_id is not null and new.lease_id is null then
        update public.fts_sync_history
        set finished_at = now(), status = case when new.error is null then 'succeeded' else 'failed' end,
            error = new.error, summary = case when new.error is null then new.summary end
        where attempted_at = new.last_attempt;
    end if;
    return new;
end;
$$;

drop trigger if exists fts_record_sync_attempt on public.fts_sync;
create trigger fts_record_sync_attempt after update on public.fts_sync
for each row execute function public.fts_record_sync_attempt();

commit;
