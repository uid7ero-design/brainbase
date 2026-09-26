import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8');
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const rawSource = readSource('scripts/create-commercial-budgeting.sql');
const source = stripComments(rawSource);

function tableBody(tableName: string): string {
  const marker = `CREATE TABLE IF NOT EXISTS ${tableName} (`;
  const start = source.indexOf(marker);
  expect(start, `expected to find ${marker}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(');', start);
  return source.slice(start, end);
}

describe('Phase C7.7A — cost-centre tenant-integrity prerequisite', () => {
  it('defensively ensures the named UNIQUE(id, organisation_id) anchor exists', () => {
    expect(source).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint\s*WHERE conname = 'commercial_cost_centres_id_organisation_id_key'/);
    expect(source).toMatch(/ALTER TABLE commercial_cost_centres\s*ADD CONSTRAINT commercial_cost_centres_id_organisation_id_key\s*UNIQUE \(id, organisation_id\)/);
  });
});

describe('Phase C7.7A — commercial_budget_accounts', () => {
  const body = tableBody('commercial_budget_accounts');

  it('is tenant scoped with unique code and composite identity anchor', () => {
    expect(body).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/);
    expect(body).toMatch(/UNIQUE \(organisation_id, code\)/);
    expect(body).toMatch(/UNIQUE \(id, organisation_id\)/);
  });

  it('is a classification master only, with no legacy GL or commitment totals', () => {
    expect(body).not.toMatch(/financial_models|\bgl\b|committed|encumbrance|actual_cents/i);
  });
});

describe('Phase C7.7A — commercial_budgets', () => {
  const body = tableBody('commercial_budgets');

  it('composite-FKs to the same-tenant financial year', () => {
    expect(body).toMatch(/FOREIGN KEY \(financial_year_id, organisation_id\)\s*REFERENCES commercial_financial_years \(id, organisation_id\)/);
  });

  it('allows exactly one Budget identity per tenant/year/currency', () => {
    expect(body).toMatch(/UNIQUE \(organisation_id, financial_year_id, currency\)/);
  });

  it('constrains tax basis and periodisation mode to the approved values', () => {
    expect(body).toMatch(/CHECK \(tax_basis IN \('EXCLUSIVE', 'INCLUSIVE'\)\)/);
    expect(body).toMatch(/CHECK \(periodisation_mode IN \('ANNUAL_ONLY', 'PERIODISED'\)\)/);
  });

  it('stores explicit currency and carries no annual/period amount cache', () => {
    expect(body).toMatch(/currency\s+TEXT NOT NULL/);
    expect(body).not.toMatch(/annual_budget_cents|period_budget_cents|committed_cents|actual_cents/i);
  });
});
describe('Phase C7.7A — commercial_budget_versions', () => {
  const body = tableBody('commercial_budget_versions');

  it('has DRAFT/ACTIVE/SUPERSEDED lifecycle and positive version numbers', () => {
    expect(body).toMatch(/version_number\s+INTEGER NOT NULL CHECK \(version_number >= 1\)/);
    expect(body).toMatch(/CHECK \(status IN \('DRAFT', 'ACTIVE', 'SUPERSEDED'\)\)/);
  });

  it('is tenant-safe to its Budget and exposes the three-column anchor for the active pointer', () => {
    expect(body).toMatch(/FOREIGN KEY \(budget_id, organisation_id\)\s*REFERENCES commercial_budgets \(id, organisation_id\)/);
    expect(body).toMatch(/UNIQUE \(id, budget_id, organisation_id\)/);
  });

  it('enforces lifecycle timestamp shape and at most one ACTIVE version per Budget', () => {
    expect(body).toMatch(/commercial_budget_versions_activation_shape_check/);
    expect(source).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_budget_versions_one_active\s*ON commercial_budget_versions\(budget_id\)\s*WHERE status = 'ACTIVE'/);
  });

  it('cycle-safe active_version_id can only point to this same Budget and tenant', () => {
    expect(source).toMatch(/FOREIGN KEY \(active_version_id, id, organisation_id\)\s*REFERENCES commercial_budget_versions \(id, budget_id, organisation_id\)/);
  });
});

describe('Phase C7.7A — commercial_budget_lines', () => {
  const body = tableBody('commercial_budget_lines');

  it('uses BIGINT non-negative annual minor-unit amounts', () => {
    expect(body).toMatch(/annual_budget_cents\s+BIGINT NOT NULL CHECK \(annual_budget_cents >= 0\)/);
  });

  it('enforces one account × cost-centre line per Budget version', () => {
    expect(body).toMatch(/UNIQUE \(budget_version_id, budget_account_id, cost_centre_id\)/);
  });

  it('composite-FKs version, account and cost centre to the same tenant', () => {
    expect(body).toMatch(/FOREIGN KEY \(budget_version_id, organisation_id\)\s*REFERENCES commercial_budget_versions \(id, organisation_id\)/);
    expect(body).toMatch(/FOREIGN KEY \(budget_account_id, organisation_id\)\s*REFERENCES commercial_budget_accounts \(id, organisation_id\)/);
    expect(body).toMatch(/FOREIGN KEY \(cost_centre_id, organisation_id\)\s*REFERENCES commercial_cost_centres \(id, organisation_id\)/);
  });

  it('does not duplicate currency or tax basis from the Budget header', () => {
    expect(body).not.toMatch(/\bcurrency\b|tax_basis/);
  });
});
describe('Phase C7.7A — commercial_budget_period_allocations', () => {
  const body = tableBody('commercial_budget_period_allocations');

  it('uses BIGINT non-negative minor-unit allocations', () => {
    expect(body).toMatch(/amount_cents\s+BIGINT NOT NULL CHECK \(amount_cents >= 0\)/);
  });

  it('allows only one allocation per Budget line and financial period', () => {
    expect(body).toMatch(/UNIQUE \(budget_line_id, financial_period_id\)/);
  });

  it('composite-FKs line and financial period to the same tenant', () => {
    expect(body).toMatch(/FOREIGN KEY \(budget_line_id, organisation_id\)\s*REFERENCES commercial_budget_lines \(id, organisation_id\)/);
    expect(body).toMatch(/FOREIGN KEY \(financial_period_id, organisation_id\)\s*REFERENCES commercial_financial_periods \(id, organisation_id\)/);
  });
});

describe('Phase C7.7A — commercial_budget_commitment_mappings', () => {
  const body = tableBody('commercial_budget_commitment_mappings');

  it('is version-scoped and permits only one mapping per cost centre in a version', () => {
    expect(body).toMatch(/UNIQUE \(budget_version_id, cost_centre_id\)/);
    expect(body).not.toMatch(/active\s+BOOLEAN/);
  });

  it('composite-FKs version, cost centre and account to the same tenant', () => {
    expect(body).toMatch(/FOREIGN KEY \(budget_version_id, organisation_id\)\s*REFERENCES commercial_budget_versions \(id, organisation_id\)/);
    expect(body).toMatch(/FOREIGN KEY \(cost_centre_id, organisation_id\)\s*REFERENCES commercial_cost_centres \(id, organisation_id\)/);
    expect(body).toMatch(/FOREIGN KEY \(budget_account_id, organisation_id\)\s*REFERENCES commercial_budget_accounts \(id, organisation_id\)/);
  });
});
describe('Phase C7.7A — migration containment', () => {
  it('creates all six governed Budget tables and no legacy financial_models table', () => {
    for (const table of [
      'commercial_budget_accounts',
      'commercial_budgets',
      'commercial_budget_versions',
      'commercial_budget_lines',
      'commercial_budget_period_allocations',
      'commercial_budget_commitment_mappings',
    ]) {
      expect(source).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
    expect(source).not.toMatch(/CREATE TABLE IF NOT EXISTS financial_models/i);
  });

  it('does not mutate legacy financial_models or purchase-order schemas', () => {
    expect(source).not.toMatch(/ALTER TABLE\s+financial_models/i);
    expect(source).not.toMatch(/ALTER TABLE\s+commercial_purchase_orders/i);
    expect(source).not.toMatch(/ALTER TABLE\s+commercial_purchase_order_lines/i);
    expect(source).not.toMatch(/financial_models\.line_items|forecast_overrides/i);
  });

  it('contains no destructive DDL/DML', () => {
    expect(source).not.toMatch(/\bDROP\s+(TABLE|CONSTRAINT|INDEX|COLUMN)\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toMatch(/\bTRUNCATE\b/i);
    expect(source).not.toMatch(/ALTER TABLE[^;]+DROP/i);
  });

  it('every CREATE TABLE and CREATE INDEX is idempotent', () => {
    expect(source.match(/CREATE TABLE(?! IF NOT EXISTS)/g) ?? []).toHaveLength(0);
    expect(source.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) ?? []).toHaveLength(0);
  });

  it('keeps activation-only invariants explicitly deferred to C7.7D rather than adding hidden triggers', () => {
    expect(source).not.toMatch(/CREATE\s+(OR REPLACE\s+)?FUNCTION|CREATE\s+TRIGGER/i);
    expect(rawSource).toContain('ANNUAL_ONLY => no period allocations');
    expect(rawSource).toContain('PERIODISED => allocations equal annual_budget_cents exactly');
    expect(rawSource).toContain('ACTIVE/SUPERSEDED versions are immutable');
  });
});
