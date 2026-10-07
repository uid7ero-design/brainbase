import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(path.resolve(process.cwd(), 'scripts/create-commercial-external-gl.sql'), 'utf8');
const domain = fs.readFileSync(path.resolve(process.cwd(), 'lib/commercial/externalGl.ts'), 'utf8');

describe('C7.9D — external GL schema/domain contract', () => {
  it('uses explicit tenant-scoped Budget-account mappings', () => {
    expect(migration).toContain('commercial_external_gl_account_mappings');
    expect(migration).toContain('FOREIGN KEY (budget_account_id, organisation_id)');
    expect(migration).toContain('REFERENCES commercial_budget_accounts(id, organisation_id)');
    expect(migration).toContain('source_system_id');
    expect(migration).toContain('external_gl_account_code');
  });

  it('uses explicit tenant-scoped cost-centre mappings when the external GL carries dimension codes', () => {
    expect(migration).toContain('commercial_external_gl_cost_centre_mappings');
    expect(migration).toContain('external_cost_centre_code');
    expect(migration).toContain('FOREIGN KEY (cost_centre_id, organisation_id)');
    expect(migration).toContain('REFERENCES commercial_cost_centres(id, organisation_id)');
    expect(domain).toContain('createExternalGlCostCentreMapping');
    expect(domain).toContain('retireExternalGlCostCentreMapping');
    expect(domain).toContain("params.organisationId + '|CC|' + sourceSystemId + '|' + externalCostCentreCode");
  });

  it('stores effective dating and rejects overlapping ACTIVE mappings in the domain', () => {
    expect(migration).toContain('effective_from');
    expect(migration).toContain('effective_to');
    expect(domain).toContain('daterange(');
    expect(domain).toContain("'OVERLAPPING_MAPPING'");
    expect(domain).toContain('pg_advisory_xact_lock');
  });

  it('discovers finance source IDs only from tenant-scoped finance evidence', () => {
    expect(domain).toContain('listExternalGlSourceSystemIds');
    expect(domain).toContain('FROM commercial_external_gl_account_mappings');
    expect(domain).toContain('FROM commercial_external_gl_cost_centre_mappings');
    expect(domain).toContain('FROM commercial_external_gl_entries');
    expect(domain).toContain('FROM commercial_finance_reconciliations');
    expect((domain.match(/WHERE organisation_id=\$\{organisationId\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('contains no fuzzy mapping by names, supplier or description', () => {
    expect(domain).not.toMatch(/levenshtein|similarity\(|fuzzy|supplier.*mapping/i);
    expect(domain).not.toMatch(/ILIKE.*external_gl_account_name/i);
    expect(domain).toContain('external_gl_account_code');
  });

  it('makes external GL identity tenant/source scoped and idempotent', () => {
    expect(migration).toContain('UNIQUE (organisation_id, source_system_id, external_entry_id)');
    expect(domain).toContain('ON CONFLICT (organisation_id,source_system_id,external_entry_id) DO NOTHING');
    expect(domain).toContain("'IMPORTED' | 'IDEMPOTENT' | 'CONFLICT'");
    expect(domain).toContain('staleReconciliationCount');
    expect(domain).toContain("'EXTERNAL_IDENTITY_CONFLICT'");
  });

  it('preserves immutable source lineage and raw currency/amount', () => {
    expect(migration).toContain('source_payload_hash');
    expect(migration).toContain('source_lineage_id');
    expect(migration).toContain('amount_minor_units        BIGINT');
    expect(migration).toContain('commercial_external_gl_entries_immutable');
  });

  it('prohibits cross-currency reconciliation without FX policy', () => {
    expect(domain).toContain('assertSameReconciliationCurrency');
    expect(domain).toContain("'CURRENCY_MISMATCH'");
    expect(domain).toContain('Cross-currency reconciliation is prohibited');
  });

  it('is additive and does not mutate supplier bills or Budget source facts', () => {
    expect(migration).not.toMatch(/ALTER TABLE commercial_supplier_bills/i);
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE/i);
    expect(domain).not.toMatch(/UPDATE\s+commercial_supplier_bills/i);
  });
});
