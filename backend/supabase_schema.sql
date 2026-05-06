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

create table if not exists workspace_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  company_name text not null,
  legal_name text,
  registration_number text,
  business_type text not null,
  primary_industry text not null,
  secondary_industries text[],
  about_company text not null,
  tagline text,
  year_established int,
  company_size text,
  vision text,
  mission text,
  core_values text[],
  country text not null,
  city text not null,
  state_or_region text,
  postcode text,
  address_line_1 text,
  address_line_2 text,
  email text not null,
  phone_number text,
  website text,
  linkedin_url text,
  twitter_url text,
  instagram_url text,
  facebook_url text,
  monthly_revenue_range text,
  employee_count int,
  operating_stage text not null,
  delivery_model text not null,
  target_customer_type text,
  primary_revenue_model text,
  key_offering_focus text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  service_name text not null,
  service_category text not null,
  service_description text,
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
  updated_at timestamptz default now()
);
-- Financial documents (invoice_template, sales_quotation) create one record per
-- document, so the (user_id, type) uniqueness constraint must not exist.
alter table blueprint_documents drop constraint if exists blueprint_documents_user_id_type_key;

create table if not exists blueprint_document_shares (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete cascade,
  document_id text references blueprint_documents(id) on delete cascade,
  token text unique not null,
  revoked boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz,
  expires_at timestamptz
);

create index if not exists blueprint_document_shares_token_idx on blueprint_document_shares(token);
create index if not exists blueprint_document_shares_document_idx on blueprint_document_shares(document_id);

-- Workspace invitations: pending/accepted/revoked invites with granular permissions
create table if not exists workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  invited_by_user_id text references users(id) on delete cascade,
  email text,
  token text unique not null,
  permission_type text not null,
  permissions jsonb not null default '{}',
  status text not null default 'pending',
  created_at timestamptz default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_by_user_id text references users(id)
);

create index if not exists workspace_invitations_token_idx on workspace_invitations(token);
create index if not exists workspace_invitations_workspace_idx on workspace_invitations(workspace_id);

-- Workspace members: users who have accepted an invitation and their access permissions
create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id text references workspaces(id) on delete cascade,
  user_id text references users(id) on delete cascade,
  invited_by_user_id text references users(id),
  permission_type text not null,
  permissions jsonb not null default '{}',
  role text not null default 'member',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(workspace_id, user_id)
);

create index if not exists workspace_members_workspace_idx on workspace_members(workspace_id);
create index if not exists workspace_members_user_idx on workspace_members(user_id);

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
