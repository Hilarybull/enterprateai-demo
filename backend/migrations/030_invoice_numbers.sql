-- ============================================================
-- Migration 030: invoice numbers unique per business.
--
-- Invoices are stored inside the workspace document, so the constraint lives
-- on a ledger of the numbers in use: UNIQUE (business_id, invoice_number).
-- New numbers come from a per-business counter that only goes up.
-- Both are seeded from the invoices that exist now. Where two invoices
-- already share a number, the older one keeps it in the ledger and the pair
-- is reported by GET /businesses/{id}/agent/integrity.
-- Safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS business_doc_counters (
    business_id  TEXT NOT NULL,
    doc_type     TEXT NOT NULL,                 -- 'invoice'
    day_key      TEXT NOT NULL,                 -- ddmmyy, the suffix of INV-<n><ddmmyy>
    last_n       INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (business_id, doc_type, day_key)
);

CREATE TABLE IF NOT EXISTS business_invoice_numbers (
    business_id     TEXT NOT NULL,
    invoice_number  TEXT NOT NULL,              -- upper-cased and trimmed
    invoice_id      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_business_invoice_number UNIQUE (business_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_business_invoice_numbers_invoice ON business_invoice_numbers(business_id, invoice_id);

-- The next sequence number for a business, document type and day, in one
-- statement, so two saves at the same moment can never get the same number.
CREATE OR REPLACE FUNCTION next_business_doc_seq(p_business TEXT, p_type TEXT, p_day TEXT)
RETURNS INTEGER
LANGUAGE sql
AS $$
    INSERT INTO business_doc_counters (business_id, doc_type, day_key, last_n, updated_at)
    VALUES (p_business, p_type, p_day, 1, NOW())
    ON CONFLICT (business_id, doc_type, day_key)
    DO UPDATE SET last_n = business_doc_counters.last_n + 1, updated_at = NOW()
    RETURNING last_n;
$$;

-- Seed the ledger from the invoices that exist (oldest first for a shared number).
INSERT INTO business_invoice_numbers (business_id, invoice_number, invoice_id, created_at)
SELECT DISTINCT ON (business_id, invoice_number) business_id, invoice_number, invoice_id, created_at
FROM (
    SELECT w.id::text AS business_id,
           UPPER(TRIM(COALESCE(NULLIF(inv->>'invoice_number', ''), inv->>'reference'))) AS invoice_number,
           inv->>'id' AS invoice_id,
           COALESCE(NULLIF(inv->>'created_at', '')::timestamptz, NOW()) AS created_at
    FROM workspaces w
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(w.data->'financials'->'invoices') = 'array' THEN w.data->'financials'->'invoices' ELSE '[]'::jsonb END
    ) AS inv
) existing
WHERE invoice_number IS NOT NULL AND invoice_number <> '' AND invoice_id IS NOT NULL
ORDER BY business_id, invoice_number, created_at
ON CONFLICT DO NOTHING;

-- Seed the counters past every number of the form INV-<n><ddmmyy> already in use.
INSERT INTO business_doc_counters (business_id, doc_type, day_key, last_n)
SELECT business_id, 'invoice', RIGHT(invoice_number, 6), MAX(SUBSTRING(invoice_number FROM '^INV-([0-9]+)[0-9]{6}$')::INTEGER)
FROM business_invoice_numbers
WHERE invoice_number ~ '^INV-[0-9]{1,9}[0-9]{6}$'
GROUP BY business_id, RIGHT(invoice_number, 6)
ON CONFLICT (business_id, doc_type, day_key)
DO UPDATE SET last_n = GREATEST(business_doc_counters.last_n, EXCLUDED.last_n);

NOTIFY pgrst, 'reload schema';
