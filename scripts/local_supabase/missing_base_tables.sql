-- LOCAL ONLY: two tables the code and migrations use but no file in the repository creates.
create table if not exists user_subscriptions (
  user_id text primary key,
  plan_key text default 'explorer',
  billing_period text,
  status text,
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_started_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists idea_validation_results (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  workspace_id text,
  business_name text,
  service_name text,
  total_score numeric,
  confidence_score numeric,
  pathway text,
  metrics jsonb,
  scoring_details jsonb,
  research_data jsonb,
  market_research jsonb,
  market_fit jsonb,
  report_narration jsonb,
  created_at timestamptz default now()
);
