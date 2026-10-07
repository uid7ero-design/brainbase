-- Phase C7.9B — append-only Commercial finance adjustment journal.
-- Additive/idempotent. Posted monetary content is immutable; corrections use reversal.
-- Signed minor units: positive increases effective Budget Actual; negative reduces it.
-- NOT run automatically; rehearse against disposable PostgreSQL first.

CREATE TABLE IF NOT EXISTS commercial_finance_adjustments (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id               TEXT NOT NULL REFERENCES organisations(id),
  adjustment_number             BIGINT GENERATED ALWAYS AS IDENTITY,
  status                        TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT','POSTED','REVERSED')),
  adjustment_type               TEXT NOT NULL CHECK (adjustment_type IN (
                                  'PRIOR_PERIOD_RECLASSIFICATION',
                                  'BUDGET_CLASSIFICATION_CORRECTION',
                                  'EXTERNAL_GL_TRUE_UP',
                                  'MANUAL_FINANCE_ADJUSTMENT'
                                )),
  effective_financial_period_id UUID NOT NULL,
  reference_financial_period_id UUID,
  currency                      TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  description                   TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  reason_code                   TEXT NOT NULL CHECK (length(btrim(reason_code)) > 0),
  source_type                   TEXT,
  source_id                     TEXT,
  reversal_of_adjustment_id     UUID,
  created_by                    TEXT NOT NULL REFERENCES users(id),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by                     TEXT REFERENCES users(id),
  posted_at                     TIMESTAMPTZ,
  reversed_by                   TEXT REFERENCES users(id),
  reversed_at                   TIMESTAMPTZ,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (organisation_id, adjustment_number),
  UNIQUE (id, organisation_id),
  UNIQUE (id, organisation_id, effective_financial_period_id),

  CONSTRAINT commercial_finance_adjustments_effective_period_org_fkey
    FOREIGN KEY (effective_financial_period_id, organisation_id)
    REFERENCES commercial_financial_periods(id, organisation_id),

  CONSTRAINT commercial_finance_adjustments_reference_period_org_fkey
    FOREIGN KEY (reference_financial_period_id, organisation_id)
    REFERENCES commercial_financial_periods(id, organisation_id),

  CONSTRAINT commercial_finance_adjustments_reversal_org_fkey
    FOREIGN KEY (reversal_of_adjustment_id, organisation_id)
    REFERENCES commercial_finance_adjustments(id, organisation_id),

  CHECK (reversal_of_adjustment_id IS NULL OR reversal_of_adjustment_id <> id),
  CONSTRAINT commercial_finance_adjustments_lifecycle_shape
    CHECK (
      (status = 'DRAFT'
        AND posted_by IS NULL AND posted_at IS NULL
        AND reversed_by IS NULL AND reversed_at IS NULL
        AND reversal_of_adjustment_id IS NULL)
      OR
      (status = 'POSTED'
        AND posted_by IS NOT NULL AND posted_at IS NOT NULL
        AND reversed_by IS NULL AND reversed_at IS NULL)
      OR
      (status = 'REVERSED'
        AND posted_by IS NOT NULL AND posted_at IS NOT NULL
        AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL
        AND reversal_of_adjustment_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_commercial_finance_adjustments_org_status
  ON commercial_finance_adjustments(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_finance_adjustments_org_period
  ON commercial_finance_adjustments(organisation_id, effective_financial_period_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_finance_adjustments_one_reversal
  ON commercial_finance_adjustments(reversal_of_adjustment_id)
  WHERE reversal_of_adjustment_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS commercial_finance_adjustment_lines (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id              TEXT NOT NULL REFERENCES organisations(id),
  adjustment_id                UUID NOT NULL,
  financial_period_id          UUID NOT NULL,
  position                     INTEGER NOT NULL CHECK (position >= 1),
  budget_account_id            UUID NOT NULL,
  cost_centre_id               UUID NOT NULL,
  amount_exclusive_cents       BIGINT NOT NULL,
  tax_cents                    BIGINT NOT NULL,
  amount_inclusive_cents       BIGINT NOT NULL,
  source_supplier_bill_line_id UUID,
  narrative                    TEXT,
  resolved_budget_id           UUID,
  resolved_budget_version_id   UUID,
  resolved_budget_line_id      UUID,
  resolved_tax_basis           TEXT CHECK (resolved_tax_basis IN ('EXCLUSIVE','INCLUSIVE')),
  budget_basis_cents           BIGINT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (adjustment_id, position),
  UNIQUE (id, organisation_id),
  CHECK (amount_inclusive_cents = amount_exclusive_cents + tax_cents),
  CONSTRAINT commercial_finance_adjustment_lines_adjustment_period_org_fkey
    FOREIGN KEY (adjustment_id, organisation_id, financial_period_id)
    REFERENCES commercial_finance_adjustments(id, organisation_id, effective_financial_period_id),

  CONSTRAINT commercial_finance_adjustment_lines_account_org_fkey
    FOREIGN KEY (budget_account_id, organisation_id)
    REFERENCES commercial_budget_accounts(id, organisation_id),

  CONSTRAINT commercial_finance_adjustment_lines_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres(id, organisation_id),

  CONSTRAINT commercial_finance_adjustment_lines_source_bill_line_org_fkey
    FOREIGN KEY (source_supplier_bill_line_id, organisation_id)
    REFERENCES commercial_supplier_bill_lines(id, organisation_id),

  CONSTRAINT commercial_finance_adjustment_lines_resolved_budget_org_fkey
    FOREIGN KEY (resolved_budget_id, organisation_id)
    REFERENCES commercial_budgets(id, organisation_id),

  CONSTRAINT commercial_finance_adjustment_lines_resolved_version_org_fkey
    FOREIGN KEY (resolved_budget_version_id, organisation_id)
    REFERENCES commercial_budget_versions(id, organisation_id),

  CONSTRAINT commercial_finance_adjustment_lines_resolved_line_org_fkey
    FOREIGN KEY (resolved_budget_line_id, organisation_id)
    REFERENCES commercial_budget_lines(id, organisation_id),

  CONSTRAINT commercial_finance_adjustment_lines_resolution_shape
    CHECK (
      (resolved_budget_id IS NULL AND resolved_budget_version_id IS NULL
        AND resolved_budget_line_id IS NULL AND resolved_tax_basis IS NULL
        AND budget_basis_cents IS NULL)
      OR
      (resolved_budget_id IS NOT NULL AND resolved_budget_version_id IS NOT NULL
        AND resolved_budget_line_id IS NOT NULL AND resolved_tax_basis IS NOT NULL
        AND budget_basis_cents IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_commercial_finance_adjustment_lines_org_adjustment
  ON commercial_finance_adjustment_lines(organisation_id, adjustment_id);
CREATE INDEX IF NOT EXISTS idx_commercial_finance_adjustment_lines_org_period
  ON commercial_finance_adjustment_lines(organisation_id, financial_period_id);
CREATE INDEX IF NOT EXISTS idx_commercial_finance_adjustment_lines_budget_grain
  ON commercial_finance_adjustment_lines(
    organisation_id, resolved_budget_version_id, budget_account_id, cost_centre_id
  );

CREATE TABLE IF NOT EXISTS commercial_finance_adjustment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT NOT NULL REFERENCES organisations(id),
  adjustment_id     UUID NOT NULL,
  event_type        TEXT NOT NULL CHECK (event_type IN ('CREATED','POSTED','REVERSED')),
  actor_user_id     TEXT NOT NULL REFERENCES users(id),
  event_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT commercial_finance_adjustment_events_adjustment_org_fkey
    FOREIGN KEY (adjustment_id, organisation_id)
    REFERENCES commercial_finance_adjustments(id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_finance_adjustment_events_org_adjustment
  ON commercial_finance_adjustment_events(organisation_id, adjustment_id, event_at);

CREATE OR REPLACE FUNCTION commercial_finance_adjustment_event_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finance adjustment events are immutable';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_commercial_finance_adjustment_event_guard'
      AND tgrelid = 'commercial_finance_adjustment_events'::regclass
  ) THEN
    CREATE TRIGGER trg_commercial_finance_adjustment_event_guard
      BEFORE UPDATE OR DELETE ON commercial_finance_adjustment_events
      FOR EACH ROW EXECUTE FUNCTION commercial_finance_adjustment_event_guard();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION commercial_finance_adjustment_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'posted finance adjustments are append-only';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'reversed finance adjustments are immutable';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status <> 'REVERSED'
       OR OLD.adjustment_type IS DISTINCT FROM NEW.adjustment_type
       OR OLD.effective_financial_period_id IS DISTINCT FROM NEW.effective_financial_period_id
       OR OLD.reference_financial_period_id IS DISTINCT FROM NEW.reference_financial_period_id
       OR OLD.currency IS DISTINCT FROM NEW.currency
       OR OLD.description IS DISTINCT FROM NEW.description
       OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
       OR OLD.source_type IS DISTINCT FROM NEW.source_type
       OR OLD.source_id IS DISTINCT FROM NEW.source_id
       OR OLD.reversal_of_adjustment_id IS DISTINCT FROM NEW.reversal_of_adjustment_id
       OR OLD.posted_by IS DISTINCT FROM NEW.posted_by
       OR OLD.posted_at IS DISTINCT FROM NEW.posted_at
    THEN
      RAISE EXCEPTION 'posted finance adjustment content is immutable';
    END IF;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT','POSTED') THEN
    RAISE EXCEPTION 'invalid finance adjustment lifecycle transition';
  END IF;

  IF OLD.reversal_of_adjustment_id IS NOT NULL AND NEW.status = 'REVERSED' THEN
    RAISE EXCEPTION 'a reversal adjustment cannot itself be reversed';
  END IF;

  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_commercial_finance_adjustment_guard'
      AND tgrelid = 'commercial_finance_adjustments'::regclass
  ) THEN
    CREATE TRIGGER trg_commercial_finance_adjustment_guard
      BEFORE UPDATE OR DELETE ON commercial_finance_adjustments
      FOR EACH ROW EXECUTE FUNCTION commercial_finance_adjustment_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION commercial_finance_adjustment_line_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_reversal_of UUID;
  v_posted_at TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status
    FROM commercial_finance_adjustments
    WHERE id = OLD.adjustment_id
      AND organisation_id = OLD.organisation_id;

    IF v_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'posted finance adjustment lines are immutable';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status, reversal_of_adjustment_id, posted_at
    INTO v_status, v_reversal_of, v_posted_at
  FROM commercial_finance_adjustments
  WHERE id = NEW.adjustment_id
    AND organisation_id = NEW.organisation_id;

  IF v_status = 'DRAFT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_status = 'POSTED'
       AND v_reversal_of IS NOT NULL
       AND v_posted_at = transaction_timestamp()
    THEN
      RETURN NEW;
    END IF;
    IF v_status IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'posted finance adjustment lines are immutable';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_commercial_finance_adjustment_line_guard'
      AND tgrelid = 'commercial_finance_adjustment_lines'::regclass
  ) THEN
    CREATE TRIGGER trg_commercial_finance_adjustment_line_guard
      BEFORE INSERT OR UPDATE OR DELETE ON commercial_finance_adjustment_lines
      FOR EACH ROW EXECUTE FUNCTION commercial_finance_adjustment_line_guard();
  END IF;
END $$;
