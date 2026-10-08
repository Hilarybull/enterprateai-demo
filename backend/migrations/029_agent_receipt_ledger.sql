-- ============================================================
-- Migration 029: receipt numbers that are unique per business, forever.
--
-- Receipt numbers used to be counted from the receipts currently on the
-- invoices. When a receipt record was lost, its number was handed out again
-- (REC-1031026 went to two customers). Numbers now come from a counter that
-- only goes up, and every issued number is kept in a ledger with a unique
-- constraint. Both are seeded from the Agent's own history of issued and
-- sent receipts, so numbers already sent are never reused.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_receipt_counters (
    business_id  TEXT NOT NULL,
    day_key      TEXT NOT NULL,                 -- ddmmyy, the suffix of REC-<n><ddmmyy>
    last_n       INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_id, day_key)
);

CREATE TABLE IF NOT EXISTS agent_receipts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     TEXT NOT NULL,
    receipt_number  TEXT NOT NULL,
    invoice_id      TEXT NOT NULL,
    payment_id      TEXT NOT NULL,
    amount          NUMERIC,
    currency        TEXT,
    run_id          UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    sent_to         TEXT,
    message_id      TEXT,
    CONSTRAINT uq_agent_receipts_number  UNIQUE (business_id, receipt_number),
    CONSTRAINT uq_agent_receipts_payment UNIQUE (business_id, invoice_id, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_receipts_invoice ON agent_receipts(business_id, invoice_id);

-- The next sequence number for a business and day. One statement, so two
-- receipts issued at the same moment can never get the same number.
CREATE OR REPLACE FUNCTION agent_next_receipt_seq(p_business TEXT, p_day TEXT)
RETURNS INTEGER
LANGUAGE sql
AS $$
    INSERT INTO agent_receipt_counters (business_id, day_key, last_n, updated_at)
    VALUES (p_business, p_day, 1, NOW())
    ON CONFLICT (business_id, day_key)
    DO UPDATE SET last_n = agent_receipt_counters.last_n + 1, updated_at = NOW()
    RETURNING last_n;
$$;

-- Seed the ledger from history: every receipt the Agent created
-- (key "receipt:<invoice>:<payment>"), sent (key
-- "send_receipt:<invoice>:<payment>:<email>") or put forward for sending (a
-- send_receipt approval). Where one number was issued twice, the earliest
-- keeps it; the later one is reported by the receipt integrity check
-- (GET /businesses/{id}/agent/integrity).
INSERT INTO agent_receipts (business_id, receipt_number, invoice_id, payment_id, run_id, created_at, sent_at, sent_to, message_id)
SELECT DISTINCT ON (i.business_id, i.receipt_number)
       i.business_id, i.receipt_number, i.invoice_id, i.payment_id, i.run_id, i.created_at,
       s.completed_at, s.result->>'sent_to', s.result->>'message_id'
FROM (
    SELECT business_id, result->>'receipt_number' AS receipt_number, split_part(key, ':', 2) AS invoice_id,
           split_part(key, ':', 3) AS payment_id, run_id, COALESCE(completed_at, created_at) AS created_at
    FROM agent_idempotency
    WHERE (key LIKE 'receipt:%' OR key LIKE 'send_receipt:%') AND result->>'receipt_number' IS NOT NULL
    UNION ALL
    SELECT business_id, payload->>'receipt_number', payload->>'invoice_id', payload->>'payment_id', run_id, created_at
    FROM agent_approvals
    WHERE tool_id = 'send_receipt' AND payload->>'receipt_number' IS NOT NULL
      AND payload->>'invoice_id' IS NOT NULL AND payload->>'payment_id' IS NOT NULL
) i
LEFT JOIN LATERAL (
    SELECT s.* FROM agent_idempotency s
    WHERE s.business_id = i.business_id
      AND s.status = 'completed'
      AND s.key LIKE 'send_receipt:' || i.invoice_id || ':' || i.payment_id || ':%'
    ORDER BY s.completed_at
    LIMIT 1
) s ON TRUE
ORDER BY i.business_id, i.receipt_number, i.created_at
ON CONFLICT DO NOTHING;

-- Seed the counters past every number ever issued, from the ledger and from history.
INSERT INTO agent_receipt_counters (business_id, day_key, last_n)
SELECT business_id, day_key, MAX(n)
FROM (
    SELECT business_id,
           RIGHT(receipt_number, 6) AS day_key,
           SUBSTRING(receipt_number FROM '^REC-([0-9]+)[0-9]{6}$')::INTEGER AS n
    FROM (
        SELECT business_id, receipt_number FROM agent_receipts
        UNION ALL
        SELECT business_id, result->>'receipt_number' FROM agent_idempotency
        WHERE key LIKE 'receipt:%' AND result->>'receipt_number' IS NOT NULL
        UNION ALL
        SELECT business_id, payload->>'receipt_number' FROM agent_approvals
        WHERE tool_id = 'send_receipt' AND payload->>'receipt_number' IS NOT NULL
    ) numbers
    WHERE receipt_number ~ '^REC-[0-9]+[0-9]{6}$'
) parsed
GROUP BY business_id, day_key
ON CONFLICT (business_id, day_key)
DO UPDATE SET last_n = GREATEST(agent_receipt_counters.last_n, EXCLUDED.last_n);

NOTIFY pgrst, 'reload schema';
