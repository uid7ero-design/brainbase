-- Phase C7.9D — governed external GL mapping/import boundary.
-- Additive/idempotent. Imported GL facts are immutable source observations.

CREATE TABLE IF NOT EXISTS commercial_external_gl_account_mappings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id          TEXT NOT NULL REFERENCES organisations(id),
  source_system_id         TEXT NOT NULL CHECK (length(btrim(source_system_id)) > 0),
  external_gl_account_code TEXT NOT NULL CHECK (length(btrim(external_gl_account_code)) > 0),
  external_gl_account_name TEXT,
  budget_account_id        UUID NOT NULL,
  effective_from           DATE NOT NULL,
  effective_to             DATE,
  status                   TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_by               TEXT NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_by               TEXT REFERENCES users(id),
  retired_at               TIMESTAMPTZ,
  UNIQUE (id, organisation_id),
  UNIQUE (organisation_id, source_system_id, external_gl_account_code, effective_from),
  FOREIGN KEY (budget_account_id, organisation_id)
    REFERENCES commercial_budget_accounts(id, organisation_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((status='ACTIVE' AND retired_by IS NULL AND retired_at IS NULL)
      OR (status='RETIRED' AND retired_by IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_external_gl_account_mappings_lookup
  ON commercial_external_gl_account_mappings(
    organisation_id, source_system_id, external_gl_account_code, effective_from, effective_to
  );

CREATE TABLE IF NOT EXISTS commercial_external_gl_entries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT NOT NULL REFERENCES organisations(id),
  source_system_id          TEXT NOT NULL CHECK (length(btrim(source_system_id)) > 0),
  external_entry_id         TEXT NOT NULL CHECK (length(btrim(external_entry_id)) > 0),
  external_journal_id       TEXT,
  external_account_code     TEXT NOT NULL CHECK (length(btrim(external_account_code)) > 0),
  external_cost_centre_code TEXT,
  transaction_date          DATE NOT NULL,
  accounting_period_key     TEXT,
  description               TEXT,
  currency                  TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor_units        BIGINT NOT NULL,
  source_payload_hash       TEXT NOT NULL CHECK (length(source_payload_hash) >= 32),
  source_lineage_id         TEXT NOT NULL CHECK (length(btrim(source_lineage_id)) > 0),
  imported_by               TEXT NOT NULL REFERENCES users(id),
  imported_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organisation_id),
  UNIQUE (organisation_id, source_system_id, external_entry_id)
);
CREATE INDEX IF NOT EXISTS idx_external_gl_entries_reconciliation
  ON commercial_external_gl_entries(
    organisation_id, source_system_id, transaction_date, currency, external_account_code
  );

CREATE OR REPLACE FUNCTION commercial_external_gl_entry_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial_external_gl_entries are immutable source observations';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='commercial_external_gl_entries_immutable') THEN
    CREATE TRIGGER commercial_external_gl_entries_immutable
      BEFORE UPDATE OR DELETE ON commercial_external_gl_entries
      FOR EACH ROW EXECUTE FUNCTION commercial_external_gl_entry_immutable_guard();
  END IF;
END $$;
