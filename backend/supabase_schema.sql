-- Supabase schema for EnterprateAI (Postgres)

create table if not exists users (
  id text primary key,
  email text unique not null,
  password_hash text,
  auth_provider text,
  google_sub text,
  name text,
  picture text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists workspaces (
  id text primary key,
  user_id text references users(id) on delete cascade,
  name text,
  data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists blueprint_documents (
  id text primary key,
  user_id text references users(id) on delete cascade,
  type text not null,
  title text,
  company_name text,
  industry text,
  pricing_model text,
  workspace_id text,
  document_markdown text,
  document_html text,
  provider text,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, type)
);

create table if not exists upgrade_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  email text,
  feature text,
  source text,
  clicked_at timestamptz default now()
);

create table if not exists scenario_runs (
  scenario_run_id text primary key,
  tenant_id text,
  business_id text,
  state_version text,
  scenario_template_id text,
  scenario_mode text,
  scenario_name text,
  scenario_type text,
  parameters jsonb,
  baseline_snapshot jsonb,
  scenario_snapshot jsonb,
  engine_version text,
  status text,
  timeline_months int,
  created_by_user_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  baseline_metrics jsonb,
  scenario_metrics jsonb,
  deltas jsonb,
  state_result text
);

create table if not exists scenario_timelines (
  id uuid primary key default gen_random_uuid(),
  scenario_run_id text,
  created_at timestamptz default now(),
  month_index int,
  revenue numeric,
  costs numeric,
  profit numeric,
  cash_balance numeric,
  stability_score numeric,
  state_label text,
  runway_months numeric
);

create table if not exists scenario_recommendations (
  recommendation_id text primary key,
  scenario_run_id text,
  action_type text,
  title text,
  description text,
  priority int,
  created_at timestamptz default now()
);

create table if not exists scenario_decisions (
  decision_memory_id text primary key,
  tenant_id text,
  business_id text,
  scenario_run_id text,
  selected_recommendation_id text,
  decision_status text,
  notes text,
  outcome_status text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists scenario_risk_signals (
  risk_signal_id text primary key,
  tenant_id text,
  business_id text,
  state_version text,
  detected_at timestamptz,
  created_at timestamptz default now(),
  risk_type text,
  severity text,
  metric_name text,
  metric_value numeric,
  threshold_value numeric,
  reason_code text
);

