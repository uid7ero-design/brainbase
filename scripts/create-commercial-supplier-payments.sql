-- Commercial Supplier / AP Settlement — AP-1 schema foundation.
--
-- Additive only. This does NOT reuse commercial_payments, which is the
-- customer / accounts-receivable receipt model.
--
-- This migration creates:
--   commercial_supplier_payments
--   commercial_supplier_payment_allocations
--
-- It also adds one safe unique identity index to commercial_supplier_bills so
-- an allocation can structurally prove that payment and bill share tenant,
-- supplier and currency.
--
-- No Budget Actual, finance-close or reconciliation table is changed.

CREATE UNIQUE INDEX IF NOT EXISTS commercial_supplier_bills_payment_identity_key
  ON commercial_supplier_bills(id, organisation_id, supplier_id, currency);

CREATE TABLE IF NOT EXISTS commercial_supplier_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       TEXT NOT NULL REFERENCES organisations(id),
  supplier_id           UUID NOT NULL,
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  method                TEXT NOT NULL
                        CHECK (method IN ('BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  reference             TEXT,
  idempotency_key       TEXT,
  request_hash          TEXT,
  provider              TEXT,
  provider_reference    TEXT,
  paid_at               TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'RECORDED'
                        CHECK (status IN ('RECORDED', 'REVERSED')),
  recorded_by           TEXT REFERENCES users(id),
  reversed_at           TIMESTAMPTZ,
  reversed_by           TEXT REFERENCES users(id),
  reversal_reason       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT commercial_supplier_payments_supplier_org_fkey
    FOREIGN KEY (supplier_id, organisation_id)
    REFERENCES commercial_suppliers(id, organisation_id),

  CONSTRAINT commercial_supplier_payments_provider_reference_requires_provider
    CHECK (
      provider_reference IS NULL
      OR (provider IS NOT NULL AND btrim(provider) <> '')
    ),

  CONSTRAINT commercial_supplier_payments_reversal_shape
    CHECK (
      (
        status = 'RECORDED'
        AND reversed_at IS NULL
        AND reversed_by IS NULL
        AND reversal_reason IS NULL
      )
      OR
      (
        status = 'REVERSED'
        AND reversed_at IS NOT NULL
        AND reversed_by IS NOT NULL
        AND reversal_reason IS NOT NULL
        AND btrim(reversal_reason) <> ''
      )
    ),

  CONSTRAINT commercial_supplier_payments_id_org_key
    UNIQUE (id, organisation_id),

  CONSTRAINT commercial_supplier_payments_allocation_identity_key
    UNIQUE (id, organisation_id, supplier_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_commercial_supplier_payments_org
  ON commercial_supplier_payments(organisation_id);

-- Preserve safe reapplication when these tables predate retry protection.
ALTER TABLE commercial_supplier_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_request_key
  ON commercial_supplier_payments(organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commercial_supplier_payments_org_supplier
  ON commercial_supplier_payments(organisation_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_commercial_supplier_payments_org_paid
  ON commercial_supplier_payments(organisation_id, paid_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_supplier_payments_provider_reference
  ON commercial_supplier_payments(organisation_id, provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS commercial_supplier_payment_allocations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT NOT NULL REFERENCES organisations(id),
  supplier_payment_id       UUID NOT NULL,
  supplier_bill_id          UUID NOT NULL,
  supplier_id               UUID NOT NULL,
  currency                  TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  allocated_amount_cents    INTEGER NOT NULL CHECK (allocated_amount_cents > 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT commercial_supplier_payment_allocations_payment_identity_fkey
    FOREIGN KEY (supplier_payment_id, organisation_id, supplier_id, currency)
    REFERENCES commercial_supplier_payments(id, organisation_id, supplier_id, currency),

  CONSTRAINT commercial_supplier_payment_allocations_bill_identity_fkey
    FOREIGN KEY (supplier_bill_id, organisation_id, supplier_id, currency)
    REFERENCES commercial_supplier_bills(id, organisation_id, supplier_id, currency),

  CONSTRAINT commercial_supplier_payment_allocations_id_org_key
    UNIQUE (id, organisation_id),

  CONSTRAINT commercial_supplier_payment_allocations_one_bill_per_payment_key
    UNIQUE (organisation_id, supplier_payment_id, supplier_bill_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_supplier_payment_allocations_org_payment
  ON commercial_supplier_payment_allocations(organisation_id, supplier_payment_id);

CREATE INDEX IF NOT EXISTS idx_commercial_supplier_payment_allocations_org_bill
  ON commercial_supplier_payment_allocations(organisation_id, supplier_bill_id);
