-- Row level security on every table in the public schema, with no policies added: nothing can be read or written with the
-- public (anon) key or a signed-in Supabase session. The backend uses the service role key, which bypasses row level security,
-- and the frontend has no Supabase client, so the app itself is unaffected.
-- Check first: the SUPABASE_SERVICE_ROLE_KEY on this deployment really is the service role key, not the anon key. With the anon
-- key every query would come back empty after this runs.
-- Safe to run more than once. To undo for one table: ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
