-- Phase C7.9E1/E2 — prepared Commercial finance reconciliation snapshots and review lifecycle.
-- Additive/idempotent. Prepared monetary evidence is immutable.
-- Reconciliation uses signed BIGINT minor units with zero-cent tolerance.

CREATE TABLE IF NOT EXISTS commercial_finance_reconciliations (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                 TEXT NOT NULL REFERENCES organisations(id),
  financial_period_id             UUID NOT NULL,
  close_id                        UUID,
  source_system_id                TEXT NOT NULL CHECK (length(btrim(source_system_id)) > 0),
  currency                        TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status                          TEXT NOT NULL DEFAULT 'PREPARED'
                                  CHECK (status IN ('PREPARED','REVIEWED','SIGNED_OFF','STALE')),
  source_actual_cents             BIGINT NOT NULL,
  finance_adjustment_cents        BIGINT NOT NULL,
  brainbase_effective_actual_cents BIGINT NOT NULL,
  external_gl_total_cents         BIGINT NOT NULL,
  variance_cents                  BIGINT NOT NULL,
  unresolved_item_count           INTEGER NOT NULL CHECK (unresolved_item_count >= 0),
  snapshot_at                     TIMESTAMPTZ NOT NULL,
  prepared_by                     TEXT NOT NULL REFERENCES users(id),
  prepared_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by                     TEXT REFERENCES users(id),
  reviewed_at                     TIMESTAMPTZ,
  notes                           TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),  UNIQUE (id, organisation_id),

  CONSTRAINT commercial_finance_reconciliations_period_org_fkey
    FOREIGN KEY (financial_period_id, organisation_id)
    REFERENCES commercial_financial_periods(id, organisation_id),

  CONSTRAINT commercial_finance_reconciliations_close_org_fkey
    FOREIGN KEY (close_id, organisation_id)
    REFERENCES commercial_financial_period_closes(id, organisation_id),

  CHECK (brainbase_effective_actual_cents = source_actual_cents + finance_adjustment_cents),
  CHECK (variance_cents = brainbase_effective_actual_cents - external_gl_total_cents),
  CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_commercial_finance_reconciliations_lookup
  ON commercial_finance_reconciliations(
    organisation_id, financial_period_id, source_system_id, currency, prepared_at DESC
  );

CREATE TABLE IF NOT EXISTS commercial_finance_reconciliation_items (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                 TEXT NOT NULL REFERENCES organisations(id),
  reconciliation_id               UUID NOT NULL,
  budget_account_id               UUID,
  external_gl_account_mapping_id  UUID,
  external_gl_account_code        TEXT,
  cost_centre_id                  UUID,  external_cost_centre_code       TEXT,
  currency                        TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source_actual_cents             BIGINT NOT NULL,
  finance_adjustment_cents        BIGINT NOT NULL,
  brainbase_effective_actual_cents BIGINT NOT NULL,
  external_gl_cents               BIGINT NOT NULL,
  variance_cents                  BIGINT NOT NULL,
  source_actual_count             INTEGER NOT NULL DEFAULT 0 CHECK (source_actual_count >= 0),
  external_entry_count            INTEGER NOT NULL DEFAULT 0 CHECK (external_entry_count >= 0),
  outcome                         TEXT NOT NULL CHECK (outcome IN (
                                    'RECONCILED',
                                    'VARIANCE',
                                    'UNMAPPED_BRAINBASE_ACCOUNT',
                                    'UNMAPPED_EXTERNAL_GL_ACCOUNT',
                                    'UNMAPPED_COST_CENTRE',
                                    'MISSING_EXTERNAL_ENTRY',
                                    'EXTERNAL_ONLY_ENTRY'
                                  )),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (id, organisation_id),

  CONSTRAINT commercial_finance_reconciliation_items_parent_org_fkey
    FOREIGN KEY (reconciliation_id, organisation_id)
    REFERENCES commercial_finance_reconciliations(id, organisation_id),

  CONSTRAINT commercial_finance_reconciliation_items_account_org_fkey
    FOREIGN KEY (budget_account_id, organisation_id)
    REFERENCES commercial_budget_accounts(id, organisation_id),  CONSTRAINT commercial_finance_reconciliation_items_mapping_org_fkey
    FOREIGN KEY (external_gl_account_mapping_id, organisation_id)
    REFERENCES commercial_external_gl_account_mappings(id, organisation_id),

  CONSTRAINT commercial_finance_reconciliation_items_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres(id, organisation_id),

  CHECK (brainbase_effective_actual_cents = source_actual_cents + finance_adjustment_cents),
  CHECK (variance_cents = brainbase_effective_actual_cents - external_gl_cents)
);

CREATE INDEX IF NOT EXISTS idx_commercial_finance_reconciliation_items_parent
  ON commercial_finance_reconciliation_items(organisation_id, reconciliation_id);

CREATE INDEX IF NOT EXISTS idx_commercial_finance_reconciliation_items_outcome
  ON commercial_finance_reconciliation_items(organisation_id, outcome);

CREATE TABLE IF NOT EXISTS commercial_finance_reconciliation_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT NOT NULL REFERENCES organisations(id),
  reconciliation_id UUID NOT NULL,
  event_type         TEXT NOT NULL CHECK (event_type IN ('PREPARED','REVIEWED')),
  actor_user_id      TEXT NOT NULL REFERENCES users(id),
  event_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  details            JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT commercial_finance_reconciliation_events_parent_org_fkey
    FOREIGN KEY (reconciliation_id, organisation_id)
    REFERENCES commercial_finance_reconciliations(id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_commercial_finance_reconciliation_events_parent
  ON commercial_finance_reconciliation_events(
    organisation_id, reconciliation_id, event_at
  );

CREATE OR REPLACE FUNCTION commercial_finance_reconciliation_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance reconciliation snapshots cannot be deleted';
  END IF;

  IF OLD.organisation_id IS DISTINCT FROM NEW.organisation_id
     OR OLD.financial_period_id IS DISTINCT FROM NEW.financial_period_id
     OR OLD.close_id IS DISTINCT FROM NEW.close_id
     OR OLD.source_system_id IS DISTINCT FROM NEW.source_system_id
     OR OLD.currency IS DISTINCT FROM NEW.currency
     OR OLD.source_actual_cents IS DISTINCT FROM NEW.source_actual_cents
     OR OLD.finance_adjustment_cents IS DISTINCT FROM NEW.finance_adjustment_cents
     OR OLD.brainbase_effective_actual_cents IS DISTINCT FROM NEW.brainbase_effective_actual_cents
     OR OLD.external_gl_total_cents IS DISTINCT FROM NEW.external_gl_total_cents
     OR OLD.variance_cents IS DISTINCT FROM NEW.variance_cents
     OR OLD.unresolved_item_count IS DISTINCT FROM NEW.unresolved_item_count
     OR OLD.snapshot_at IS DISTINCT FROM NEW.snapshot_at
     OR OLD.prepared_by IS DISTINCT FROM NEW.prepared_by
     OR OLD.prepared_at IS DISTINCT FROM NEW.prepared_at
     OR OLD.notes IS DISTINCT FROM NEW.notes
  THEN
    RAISE EXCEPTION 'prepared finance reconciliation evidence is immutable';
  END IF;

  IF OLD.status = 'PREPARED' THEN
    IF NEW.status = 'PREPARED' THEN
      IF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
        RAISE EXCEPTION 'PREPARED finance reconciliation cannot carry review evidence';
      END IF;
    ELSIF NEW.status = 'REVIEWED' THEN
      IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
        RAISE EXCEPTION 'REVIEWED finance reconciliation requires review evidence';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid finance reconciliation lifecycle transition';
    END IF;
  ELSIF OLD.status = 'REVIEWED' THEN
    IF NEW.status <> 'REVIEWED'
       OR OLD.reviewed_by IS DISTINCT FROM NEW.reviewed_by
       OR OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at
    THEN
      RAISE EXCEPTION 'REVIEWED finance reconciliation is immutable in C7.9E2';
    END IF;
  ELSE
    RAISE EXCEPTION 'finance reconciliation lifecycle state is not mutable in C7.9E2';
  END IF;

  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_commercial_finance_reconciliation_guard'
      AND tgrelid = 'commercial_finance_reconciliations'::regclass
  ) THEN
    CREATE TRIGGER trg_commercial_finance_reconciliation_guard
      BEFORE UPDATE OR DELETE ON commercial_finance_reconciliations
      FOR EACH ROW EXECUTE FUNCTION commercial_finance_reconciliation_guard();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION commercial_finance_reconciliation_item_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN  RAISE EXCEPTION 'finance reconciliation items are immutable';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_commercial_finance_reconciliation_item_guard'
      AND tgrelid = 'commercial_finance_reconciliation_items'::regclass
  ) THEN
    CREATE TRIGGER trg_commercial_finance_reconciliation_item_guard
      BEFORE UPDATE OR DELETE ON commercial_finance_reconciliation_items
      FOR EACH ROW EXECUTE FUNCTION commercial_finance_reconciliation_item_guard();
  END IF;
END $$;
