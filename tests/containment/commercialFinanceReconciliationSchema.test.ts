import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/create-commercial-finance-reconciliation.sql'),
  'utf8',
);
const domain = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/financeReconciliation.ts'),
  'utf8',
);

describe('C7.9E — cost-centre reconciliation lineage', () => {
  it('persists the explicit external cost-centre mapping used by each snapshot item', () => {
    expect(migration).toContain('external_cost_centre_mapping_id UUID');
    expect(migration).toContain('CONSTRAINT finance_recon_item_ext_cc_mapping_org_fkey');
    expect(migration).toContain('REFERENCES commercial_external_gl_cost_centre_mappings(id, organisation_id)');
    expect(domain).toContain('externalCostCentreMappingId');
    expect(domain).toContain('resolved_cc.id AS external_cost_centre_mapping_id');
  });

  it('resolves cost-centre mapping by each immutable external entry transaction date', () => {
    expect(domain).toContain('m.external_cost_centre_code = NULLIF(btrim(e.external_cost_centre_code)');
    expect(domain).toContain('m.effective_from <= e.transaction_date');
    expect(domain).toContain('(m.effective_to IS NULL OR m.effective_to >= e.transaction_date)');
  });

  it('keeps unmapped external dimensions explicit rather than guessing', () => {
    expect(domain).toContain("'UNMAPPED_COST_CENTRE'");
    expect(domain).not.toMatch(/ILIKE.*external_cost_centre/i);
    expect(domain).not.toMatch(/levenshtein|similarity\(|fuzzy/i);
  });
});
