-- Phase C7.7A — Governed Commercial Budgeting schema foundation.
--
-- Additive raw-SQL migration only. Creates the relational Budget account,
-- Budget/version/line/period-allocation and version-scoped commitment
-- mapping structures approved by docs/architecture/
-- c7-7-budget-account-allocation-design.md.
--
-- No legacy financial_models data is read or mutated. No purchase-order
-- or purchase-order-line Budget/cache columns are added.
--
-- Money: annual/period Budget amounts are BIGINT minor units. Currency and
-- tax basis live on the Budget header.
--
-- Tenant integrity: every table carries organisation_id and every
-- cross-entity Budget relationship uses a composite FK including it.
--
-- Idempotent/additive: no DROP, DELETE, TRUNCATE, or destructive ALTER.
-- NOT run automatically; rehearse on disposable PostgreSQL before rollout.

-- 0. Existing cost-centre tenant-integrity anchor.
-- Purchasing C6.2 already adds this constraint. C7.7A repeats the guard
-- defensively so this migration remains safe on any environment where
-- Commercial Core exists but the Purchasing migration history differs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_cost_centres_id_organisation_id_key'
  ) THEN
    ALTER TABLE commercial_cost_centres
      ADD CONSTRAINT commercial_cost_centres_id_organisation_id_key
      UNIQUE (id, organisation_id);
  END IF;
END $$;

-- 1. Budget accounts — BrainBase Budget classifications, not statutory GL.
CREATE TABLE IF NOT EXISTS commercial_budget_accounts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_by       TEXT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code),
  UNIQUE (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_accounts_org
  ON commercial_budget_accounts(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_accounts_org_active
  ON commercial_budget_accounts(organisation_id, active);

-- 2. Stable Budget identity: exactly one per tenant/year/currency.
CREATE TABLE IF NOT EXISTS commercial_budgets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT NOT NULL REFERENCES organisations(id),
  financial_year_id    UUID NOT NULL,
  name                 TEXT NOT NULL,
  currency             TEXT NOT NULL,
  tax_basis            TEXT NOT NULL
                         CHECK (tax_basis IN ('EXCLUSIVE', 'INCLUSIVE')),
  periodisation_mode   TEXT NOT NULL
                         CHECK (periodisation_mode IN ('ANNUAL_ONLY', 'PERIODISED')),
  active_version_id    UUID,
  created_by           TEXT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, financial_year_id, currency),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_budgets_financial_year_org_fkey
    FOREIGN KEY (financial_year_id, organisation_id)
    REFERENCES commercial_financial_years (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_budgets_org
  ON commercial_budgets(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budgets_year
  ON commercial_budgets(organisation_id, financial_year_id);

-- 3. Immutable-after-activation Budget versions.
CREATE TABLE IF NOT EXISTS commercial_budget_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT NOT NULL REFERENCES organisations(id),
  budget_id        UUID NOT NULL,
  version_number   INTEGER NOT NULL CHECK (version_number >= 1),
  status           TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
  notes            TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by     TEXT REFERENCES users(id),
  activated_at     TIMESTAMPTZ,
  superseded_at    TIMESTAMPTZ,
  UNIQUE (budget_id, version_number),
  UNIQUE (id, organisation_id),
  UNIQUE (id, budget_id, organisation_id),
  CONSTRAINT commercial_budget_versions_budget_org_fkey
    FOREIGN KEY (budget_id, organisation_id)
    REFERENCES commercial_budgets (id, organisation_id),
  CONSTRAINT commercial_budget_versions_activation_shape_check
    CHECK (
      (status = 'DRAFT' AND activated_at IS NULL AND superseded_at IS NULL)
      OR
      (status = 'ACTIVE' AND activated_at IS NOT NULL AND superseded_at IS NULL)
      OR
      (status = 'SUPERSEDED' AND activated_at IS NOT NULL AND superseded_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_versions_org
  ON commercial_budget_versions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_versions_budget
  ON commercial_budget_versions(organisation_id, budget_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_budget_versions_one_active
  ON commercial_budget_versions(budget_id)
  WHERE status = 'ACTIVE';

-- Add the cycle-safe active-version pointer only after versions exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_budgets_active_version_budget_org_fkey'
  ) THEN
    ALTER TABLE commercial_budgets
      ADD CONSTRAINT commercial_budgets_active_version_budget_org_fkey
      FOREIGN KEY (active_version_id, id, organisation_id)
      REFERENCES commercial_budget_versions (id, budget_id, organisation_id);
  END IF;
END $$;
-- 4. Annual Budget lines at account x cost-centre grain.
CREATE TABLE IF NOT EXISTS commercial_budget_lines (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT NOT NULL REFERENCES organisations(id),
  budget_version_id    UUID NOT NULL,
  budget_account_id    UUID NOT NULL,
  cost_centre_id       UUID NOT NULL,
  annual_budget_cents  BIGINT NOT NULL CHECK (annual_budget_cents >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_version_id, budget_account_id, cost_centre_id),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_budget_lines_version_org_fkey
    FOREIGN KEY (budget_version_id, organisation_id)
    REFERENCES commercial_budget_versions (id, organisation_id),
  CONSTRAINT commercial_budget_lines_account_org_fkey
    FOREIGN KEY (budget_account_id, organisation_id)
    REFERENCES commercial_budget_accounts (id, organisation_id),
  CONSTRAINT commercial_budget_lines_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_lines_org
  ON commercial_budget_lines(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_lines_version
  ON commercial_budget_lines(organisation_id, budget_version_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_lines_account_cost_centre
  ON commercial_budget_lines(organisation_id, budget_account_id, cost_centre_id);

-- 5. Optional explicit periodisation of one annual Budget line.
CREATE TABLE IF NOT EXISTS commercial_budget_period_allocations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT NOT NULL REFERENCES organisations(id),
  budget_line_id       UUID NOT NULL,
  financial_period_id  UUID NOT NULL,
  amount_cents         BIGINT NOT NULL CHECK (amount_cents >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_line_id, financial_period_id),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_budget_period_allocations_line_org_fkey
    FOREIGN KEY (budget_line_id, organisation_id)
    REFERENCES commercial_budget_lines (id, organisation_id),
  CONSTRAINT commercial_budget_period_allocations_period_org_fkey
    FOREIGN KEY (financial_period_id, organisation_id)
    REFERENCES commercial_financial_periods (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_period_allocations_org
  ON commercial_budget_period_allocations(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_period_allocations_line
  ON commercial_budget_period_allocations(organisation_id, budget_line_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_period_allocations_period
  ON commercial_budget_period_allocations(organisation_id, financial_period_id);

-- 6. Version-scoped default classification for Purchasing commitments.
-- One mapping per cost centre inside one Budget version makes account
-- attribution deterministic and preserves historical classification.
CREATE TABLE IF NOT EXISTS commercial_budget_commitment_mappings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT NOT NULL REFERENCES organisations(id),
  budget_version_id  UUID NOT NULL,
  cost_centre_id     UUID NOT NULL,
  budget_account_id  UUID NOT NULL,
  created_by         TEXT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_version_id, cost_centre_id),
  UNIQUE (id, organisation_id),
  CONSTRAINT commercial_budget_commitment_mappings_version_org_fkey
    FOREIGN KEY (budget_version_id, organisation_id)
    REFERENCES commercial_budget_versions (id, organisation_id),
  CONSTRAINT commercial_budget_commitment_mappings_cost_centre_org_fkey
    FOREIGN KEY (cost_centre_id, organisation_id)
    REFERENCES commercial_cost_centres (id, organisation_id),
  CONSTRAINT commercial_budget_commitment_mappings_account_org_fkey
    FOREIGN KEY (budget_account_id, organisation_id)
    REFERENCES commercial_budget_accounts (id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_commitment_mappings_org
  ON commercial_budget_commitment_mappings(organisation_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_commitment_mappings_version
  ON commercial_budget_commitment_mappings(organisation_id, budget_version_id);
CREATE INDEX IF NOT EXISTS idx_commercial_budget_commitment_mappings_cost_centre
  ON commercial_budget_commitment_mappings(organisation_id, cost_centre_id);

-- Activation-time invariants intentionally remain domain-transaction rules
-- for C7.7D rather than speculative triggers in C7.7A:
--   * ANNUAL_ONLY => no period allocations
--   * PERIODISED => allocations equal annual_budget_cents exactly
--   * allocation periods belong to the Budget financial year
--   * financial year is OPEN
--   * ACTIVE/SUPERSEDED versions are immutable
