begin;
create table if not exists public.forecast_snapshots (
 id uuid primary key, business_id text not null, user_id text not null,
 created_at timestamptz not null default now(), as_of date not null,
 label text not null, currency text not null, model_version text,
 forecast jsonb not null, assumptions jsonb not null default '{}'
);
create index if not exists forecast_snapshots_business on public.forecast_snapshots(business_id,created_at desc);
alter table public.forecast_snapshots enable row level security;
revoke all on public.forecast_snapshots from public,anon,authenticated;
grant select,insert on public.forecast_snapshots to service_role;
notify pgrst,'reload schema';
commit;
