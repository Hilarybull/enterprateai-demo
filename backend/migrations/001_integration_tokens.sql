-- Run this in your Supabase SQL editor to enable the integrations module.

CREATE TABLE IF NOT EXISTS integration_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  provider        text NOT NULL,          -- 'quickbooks' | 'xero' | 'zoho_crm'
  access_token    text,
  refresh_token   text,
  token_expiry    timestamptz,
  metadata        jsonb DEFAULT '{}',     -- tenant_id, realm_id, etc.
  connected_at    timestamptz DEFAULT now(),
  last_sync_at    timestamptz,
  UNIQUE (user_id, provider)
);

-- Enable Row Level Security (service role key bypasses this, which is what the backend uses)
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;
