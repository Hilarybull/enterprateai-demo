-- ============================================================
-- Migration 025: Paid add-ons — featured listings, listing boosts,
-- RFQ credit packs, and the RFQ response credit cost.
-- Safe to run multiple times.
-- ============================================================

-- One row per paid add-on purchase (Stripe Checkout session).
CREATE TABLE IF NOT EXISTS user_addons (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     TEXT NOT NULL,
    addon_key                   TEXT NOT NULL,
    kind                        TEXT NOT NULL,              -- featured_slot | featured_boosts | rfq_credits
    quantity                    INTEGER NOT NULL DEFAULT 0, -- boosts per period, or credits granted
    status                      TEXT NOT NULL DEFAULT 'active', -- active | cancelled | fulfilled
    stripe_checkout_session_id  TEXT UNIQUE,
    stripe_subscription_id      TEXT UNIQUE,
    current_period_start        TIMESTAMPTZ,
    current_period_end          TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_addons_user_kind ON user_addons(user_id, kind, status);

-- Each boost features a workspace's listing for a fixed window.
CREATE TABLE IF NOT EXISTS listing_boosts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    workspace_id  TEXT NOT NULL,
    addon_id      UUID NOT NULL REFERENCES user_addons(id) ON DELETE CASCADE,
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listing_boosts_ends_at   ON listing_boosts(ends_at);
CREATE INDEX IF NOT EXISTS idx_listing_boosts_workspace ON listing_boosts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_listing_boosts_addon     ON listing_boosts(addon_id);

-- ------------------------------------------------------------
-- Fulfil a purchase exactly once per Checkout session.
-- RFQ credit packs are granted to the main AI credit wallet.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fulfil_addon_purchase(
    p_user_id          TEXT,
    p_addon_key        TEXT,
    p_kind             TEXT,
    p_quantity         INTEGER,
    p_session_id       TEXT,
    p_subscription_id  TEXT DEFAULT NULL,
    p_period_start     TIMESTAMPTZ DEFAULT NULL,
    p_period_end       TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO user_addons (
        user_id, addon_key, kind, quantity, status,
        stripe_checkout_session_id, stripe_subscription_id,
        current_period_start, current_period_end
    ) VALUES (
        p_user_id, p_addon_key, p_kind, p_quantity,
        CASE WHEN p_kind = 'rfq_credits' THEN 'fulfilled' ELSE 'active' END,
        p_session_id, p_subscription_id,
        COALESCE(p_period_start, NOW()), p_period_end
    )
    ON CONFLICT (stripe_checkout_session_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('ok', TRUE, 'already_fulfilled', TRUE);
    END IF;

    IF p_kind = 'rfq_credits' AND p_quantity > 0 THEN
        PERFORM grant_credits(
            p_user_id, p_quantity, 'top_up',
            'RFQ credit pack ' || p_addon_key || ' [' || p_session_id || ']'
        );
    END IF;

    RETURN jsonb_build_object('ok', TRUE, 'already_fulfilled', FALSE, 'addon_id', v_id);
END;
$$;

-- ------------------------------------------------------------
-- Spend one boost from the user's active boost subscriptions.
-- Boosts stack: a new boost starts when the current one ends.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION use_listing_boost(
    p_user_id       TEXT,
    p_workspace_id  TEXT,
    p_hours         INTEGER DEFAULT 24
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_addon  user_addons%ROWTYPE;
    v_used   INTEGER;
    v_start  TIMESTAMPTZ;
    v_end    TIMESTAMPTZ;
BEGIN
    FOR v_addon IN
        SELECT * FROM user_addons
        WHERE user_id = p_user_id
          AND kind = 'featured_boosts'
          AND status = 'active'
          AND (current_period_end IS NULL OR current_period_end > NOW())
        ORDER BY current_period_end NULLS LAST
        FOR UPDATE
    LOOP
        SELECT COUNT(*) INTO v_used
        FROM listing_boosts
        WHERE addon_id = v_addon.id
          AND created_at >= COALESCE(v_addon.current_period_start, v_addon.created_at);

        IF v_used < v_addon.quantity THEN
            SELECT GREATEST(NOW(), COALESCE(MAX(ends_at), NOW())) INTO v_start
            FROM listing_boosts
            WHERE workspace_id = p_workspace_id AND ends_at > NOW();

            v_end := v_start + make_interval(hours => p_hours);

            INSERT INTO listing_boosts (user_id, workspace_id, addon_id, starts_at, ends_at)
            VALUES (p_user_id, p_workspace_id, v_addon.id, v_start, v_end);

            RETURN jsonb_build_object(
                'ok', TRUE,
                'starts_at', v_start,
                'ends_at', v_end
            );
        END IF;
    END LOOP;

    RETURN jsonb_build_object('ok', FALSE, 'error', 'NO_BOOSTS_LEFT');
END;
$$;

-- ------------------------------------------------------------
-- Replying to an RFQ costs 1 AI credit. Plan access (paid plans and
-- grandfathered accounts only) is enforced in the marketplace service,
-- so the feature itself is open to every plan here.
-- ------------------------------------------------------------
INSERT INTO credit_feature_config (
    feature_code, feature_name, credit_cost, enabled,
    minimum_plan, refundable_on_failure, credit_controlled
)
VALUES ('rfq_response', 'RFQ Response', 1, TRUE, 'explorer', TRUE, TRUE)
ON CONFLICT (feature_code) DO UPDATE SET
    feature_name = EXCLUDED.feature_name,
    credit_cost = EXCLUDED.credit_cost,
    enabled = EXCLUDED.enabled,
    minimum_plan = EXCLUDED.minimum_plan,
    refundable_on_failure = EXCLUDED.refundable_on_failure,
    credit_controlled = EXCLUDED.credit_controlled,
    updated_at = NOW();

NOTIFY pgrst, 'reload schema';
