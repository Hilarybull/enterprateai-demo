-- ============================================================
-- Migration 032: Marketplace Business Index and Claim (PRD-MKT-GTM-001).
--
-- The public business directory and the claim workflow around it: sourced
-- directory profiles, the identity keys that keep one profile per business,
-- source snapshots (provenance), claims and their verifications, claim
-- context kept through sign-in, invitations, correction and unlist reports,
-- and audit / funnel events.
--
-- A directory profile is a public projection. It is not a workspace, has no
-- user and grants no access. A business's own Marketplace settings stay in
-- that business's record (workspaces.data.marketplace).
--
-- Additive only. Switching MARKETPLACE_CLAIM_ENABLED off closes the feature
-- and leaves every row here, every verified link and every business as it is.
-- Safe to run multiple times.
-- ============================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketplace_directory_profiles', 'marketplace_directory_identities', 'marketplace_index_snapshots',
                           'marketplace_business_claims', 'marketplace_claim_verifications', 'marketplace_claim_invitations',
                           'marketplace_claim_intents', 'marketplace_directory_reports', 'marketplace_events']
  LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I (
        id           UUID PRIMARY KEY,
        business_id  TEXT NOT NULL,              -- "marketplace" for public index records; a business id for its own events
        kind         TEXT NOT NULL,
        subject_id   UUID,
        status       TEXT,
        revision     INTEGER NOT NULL DEFAULT 1,
        key          TEXT,
        data         JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by   TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )$f$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (business_id, created_at DESC)', 'idx_' || t || '_scope', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (subject_id, created_at DESC)', 'idx_' || t || '_subject', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- One profile per public address (slug), one profile per external identity (registered number,
-- website domain), one open claim per person per profile, and single-use tokens.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_profiles_slug     ON marketplace_directory_profiles   (key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_identities_key    ON marketplace_directory_identities (key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_claims_key        ON marketplace_business_claims      (key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_invitations_token ON marketplace_claim_invitations    (key) WHERE key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_intents_token     ON marketplace_claim_intents        (key) WHERE key IS NOT NULL;

-- Claims are listed per claimant (kind holds the claimant's user id) and per status for review.
CREATE INDEX IF NOT EXISTS idx_mkt_claims_claimant ON marketplace_business_claims (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mkt_claims_status   ON marketplace_business_claims (status);
CREATE INDEX IF NOT EXISTS idx_mkt_profiles_status ON marketplace_directory_profiles (status);
