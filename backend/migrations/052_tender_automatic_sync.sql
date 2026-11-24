-- NULL preserves the environment default until an administrator sets a preference.
alter table public.fts_sync add column if not exists automatic_sync boolean;
