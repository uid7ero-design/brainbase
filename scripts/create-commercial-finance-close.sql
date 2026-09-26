-- Phase C7.9A — durable Commercial finance-period close history.
-- Additive, idempotent raw SQL only. No source commercial fact is rewritten.
-- NOT run automatically; rehearse against disposable PostgreSQL first.

-- Tenant-safe anchor for close-history composite foreign keys.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_financial_periods_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_financial_periods
      ADD CONSTRAINT commercial_financial_periods_id_organisation_id_key
      UNIQUE (id, organisation_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS commercial_financial_period_closes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT NOT NULL REFERENCES organisations(id),
  financial_period_id  UUID NOT NULL,
  close_sequence       INTEGER NOT NULL CHECK (close_sequence >= 1),
  status               TEXT NOT NULL CHECK (status IN ('CLOSED', 'INVALIDATED')),
  closed_by            TEXT NOT NULL REFERENCES users(id),
  closed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  close_reason         TEXT,
  control_totals       JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  invalidated_by       TEXT REFERENCES users(id),
  invalidated_at       TIMESTAMPTZ,
  invalidation_reason  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT commercial_financial_period_closes_period_org_fkey
    FOREIGN KEY (financial_period_id, organisation_id)
    REFERENCES commercial_financial_periods(id, organisation_id),

  CONSTRAINT commercial_financial_period_closes_sequence_key
    UNIQUE (financial_period_id, close_sequence),

  CONSTRAINT commercial_financial_period_closes_id_org_key
    UNIQUE (id, organisation_id),

  CONSTRAINT commercial_financial_period_closes_invalidation_shape
    CHECK (
      (status = 'CLOSED'
        AND invalidated_by IS NULL
        AND invalidated_at IS NULL
        AND invalidation_reason IS NULL)
      OR
      (status = 'INVALIDATED'
        AND invalidated_by IS NOT NULL
        AND invalidated_at IS NOT NULL
        AND length(btrim(invalidation_reason)) > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_commercial_financial_period_closes_org_period
  ON commercial_financial_period_closes(organisation_id, financial_period_id, close_sequence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_financial_period_closes_one_current
  ON commercial_financial_period_closes(financial_period_id)
  WHERE status = 'CLOSED';
