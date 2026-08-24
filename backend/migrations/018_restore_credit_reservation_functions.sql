-- Restore the credit RPCs required by credit_guard after database migrations.
-- PostgREST must reload its schema cache after this migration is applied.

-- Keep this repair migration usable when the original credit migration was
-- skipped in the target Supabase project.
CREATE TABLE IF NOT EXISTS credit_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE,
    available_credits INTEGER NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
    held_credits INTEGER NOT NULL DEFAULT 0 CHECK (held_credits >= 0),
    lifetime_credits_issued INTEGER NOT NULL DEFAULT 0,
    lifetime_credits_used INTEGER NOT NULL DEFAULT 0,
    next_reset_at TIMESTAMPTZ,
    last_reset_at TIMESTAMPTZ,
    free_allocation_issued BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES credit_wallets(id),
    user_id TEXT NOT NULL,
    feature_code TEXT,
    generation_id UUID,
    transaction_type TEXT NOT NULL,
    credits INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    idempotency_key TEXT UNIQUE,
    description TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_feature_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code TEXT NOT NULL UNIQUE,
    feature_name TEXT NOT NULL,
    credit_cost INTEGER NOT NULL CHECK (credit_cost >= 0),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    minimum_plan TEXT NOT NULL DEFAULT 'explorer',
    refundable_on_failure BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_credit_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_code TEXT NOT NULL UNIQUE,
    allocation_type TEXT NOT NULL,
    credits_per_period INTEGER NOT NULL,
    reset_frequency TEXT,
    rollover_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    expiry_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE credit_feature_config
    ADD COLUMN IF NOT EXISTS credit_controlled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION reserve_credits(
    p_user_id TEXT,
    p_feature_code TEXT,
    p_credit_cost INTEGER,
    p_generation_id UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_wallet credit_wallets%ROWTYPE;
    v_transaction credit_transactions%ROWTYPE;
BEGIN
    SELECT * INTO v_transaction
    FROM credit_transactions
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
        RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE, 'transaction_id', v_transaction.id);
    END IF;

    SELECT * INTO v_wallet
    FROM credit_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'WALLET_NOT_FOUND');
    END IF;
    IF v_wallet.available_credits < p_credit_cost THEN
        RETURN jsonb_build_object(
            'ok', FALSE,
            'error', 'INSUFFICIENT_CREDITS',
            'available', v_wallet.available_credits,
            'required', p_credit_cost
        );
    END IF;

    UPDATE credit_wallets
    SET available_credits = available_credits - p_credit_cost,
        held_credits = held_credits + p_credit_cost,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    INSERT INTO credit_transactions (
        wallet_id, user_id, feature_code, generation_id,
        transaction_type, credits, balance_before, balance_after,
        status, idempotency_key, description
    ) VALUES (
        v_wallet.id, p_user_id, p_feature_code, p_generation_id,
        'hold', -p_credit_cost, v_wallet.available_credits,
        v_wallet.available_credits - p_credit_cost,
        'completed', p_idempotency_key, 'Credits held for ' || p_feature_code
    ) RETURNING * INTO v_transaction;

    RETURN jsonb_build_object('ok', TRUE, 'transaction_id', v_transaction.id);
END;
$$;

CREATE OR REPLACE FUNCTION commit_credits(
    p_generation_id UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_hold credit_transactions%ROWTYPE;
    v_wallet credit_wallets%ROWTYPE;
    v_commit_key TEXT := p_idempotency_key || '_commit';
BEGIN
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE idempotency_key = v_commit_key) THEN
        RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE);
    END IF;
    SELECT * INTO v_hold
    FROM credit_transactions
    WHERE generation_id = p_generation_id
      AND transaction_type = 'hold'
      AND status = 'completed'
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'HOLD_NOT_FOUND');
    END IF;
    SELECT * INTO v_wallet FROM credit_wallets WHERE id = v_hold.wallet_id FOR UPDATE;
    UPDATE credit_wallets
    SET held_credits = held_credits - ABS(v_hold.credits),
        lifetime_credits_used = lifetime_credits_used + ABS(v_hold.credits),
        updated_at = NOW()
    WHERE id = v_hold.wallet_id;
    INSERT INTO credit_transactions (
        wallet_id, user_id, feature_code, generation_id,
        transaction_type, credits, balance_before, balance_after,
        status, idempotency_key, description
    ) VALUES (
        v_hold.wallet_id, v_hold.user_id, v_hold.feature_code, p_generation_id,
        'deduction', v_hold.credits, v_wallet.available_credits,
        v_wallet.available_credits, 'completed', v_commit_key,
        'Credits committed for ' || COALESCE(v_hold.feature_code, 'unknown')
    );
    RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION release_credits(
    p_generation_id UUID,
    p_idempotency_key TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_hold credit_transactions%ROWTYPE;
    v_wallet credit_wallets%ROWTYPE;
    v_release_key TEXT := p_idempotency_key || '_release';
BEGIN
    IF EXISTS (SELECT 1 FROM credit_transactions WHERE idempotency_key = v_release_key) THEN
        RETURN jsonb_build_object('ok', TRUE, 'idempotent', TRUE);
    END IF;
    SELECT * INTO v_hold
    FROM credit_transactions
    WHERE generation_id = p_generation_id
      AND transaction_type = 'hold'
      AND status = 'completed'
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'HOLD_NOT_FOUND');
    END IF;
    SELECT * INTO v_wallet FROM credit_wallets WHERE id = v_hold.wallet_id FOR UPDATE;
    UPDATE credit_wallets
    SET available_credits = available_credits + ABS(v_hold.credits),
        held_credits = held_credits - ABS(v_hold.credits),
        updated_at = NOW()
    WHERE id = v_hold.wallet_id;
    INSERT INTO credit_transactions (
        wallet_id, user_id, feature_code, generation_id,
        transaction_type, credits, balance_before, balance_after,
        status, idempotency_key, description
    ) VALUES (
        v_hold.wallet_id, v_hold.user_id, v_hold.feature_code, p_generation_id,
        'release', ABS(v_hold.credits), v_wallet.available_credits,
        v_wallet.available_credits + ABS(v_hold.credits), 'completed',
        v_release_key, 'Credits released for ' || COALESCE(v_hold.feature_code, 'unknown')
    );
    RETURN jsonb_build_object('ok', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION grant_credits(
    p_user_id TEXT,
    p_amount INTEGER,
    p_type TEXT,
    p_reason TEXT,
    p_next_reset_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_wallet credit_wallets%ROWTYPE;
BEGIN
    INSERT INTO credit_wallets (user_id)
    VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO v_wallet
    FROM credit_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    UPDATE credit_wallets
    SET available_credits = available_credits + p_amount,
        lifetime_credits_issued = lifetime_credits_issued + p_amount,
        next_reset_at = COALESCE(p_next_reset_at, next_reset_at),
        last_reset_at = CASE WHEN p_type IN ('allocation', 'monthly') THEN NOW() ELSE last_reset_at END,
        free_allocation_issued = CASE WHEN p_type = 'allocation' THEN TRUE ELSE free_allocation_issued END,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    INSERT INTO credit_transactions (
        wallet_id, user_id, transaction_type, credits,
        balance_before, balance_after, status, description
    ) VALUES (
        v_wallet.id, p_user_id, p_type, p_amount,
        v_wallet.available_credits, v_wallet.available_credits + p_amount,
        'completed', p_reason
    );

    RETURN jsonb_build_object('ok', TRUE, 'new_balance', v_wallet.available_credits + p_amount);
END;
$$;

NOTIFY pgrst, 'reload schema';