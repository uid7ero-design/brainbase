import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'app/commercial/budgeting/commitments/page.tsx'), 'utf8');
const overview = fs.readFileSync(path.resolve(process.cwd(), 'app/commercial/page.tsx'), 'utf8');
const domain = fs.readFileSync(path.resolve(process.cwd(), 'lib/commercial/purchasingCommitments.ts'), 'utf8');

describe('Phase C7.6F — Budget commitment reporting UI contract', () => {
  it('loads only the governed budgeting commitment report endpoint', () => {
    expect(page).toContain("fetch('/api/commercial/budgeting/commitments')");
    expect(page).not.toMatch(/api\/commercial\/purchase-orders.*commitment/);
  });

  it('provides all required filters plus explicit attribution-state filtering', () => {
    for (const label of ['Financial year', 'Financial period', 'Cost centre', 'Supplier', 'Currency', 'Attribution state']) {
      expect(page).toContain(label);
    }
    expect(page).toContain("'RESOLVED'");
    expect(page).toContain("'UNRESOLVED'");
    expect(page).toContain("'AMBIGUOUS'");
  });

  it('makes all three attribution states visibly distinct and actionable', () => {
    expect(page).toContain('RESOLVED');
    expect(page).toContain('UNRESOLVED — NO MATCH');
    expect(page).toContain('AMBIGUOUS — REVIEW PERIODS');
  });

  it('keeps filtered currency totals separated and uses line-aware cost-centre filtering', () => {
    expect(page).toContain('summarizeFilteredCommitments(filtered)');
    expect(page).toContain("filters.costCentreId !== 'ALL'");
    expect(page).toContain('po.visibleLines.length');
  });

  it('exposes the report from Commercial overview only when budgeting capability is enabled', () => {
    expect(overview).toContain("capabilityKeys.has('budgeting')");
    expect(overview).toContain('hasBudgeting && <StatCard label="Purchase Commitments"');
    expect(overview).toContain('href="/commercial/budgeting/commitments"');
  });

  it('tenant-scopes supplier and effective cost-centre display joins in the governed report query', () => {
    const reportRegion = domain.slice(domain.indexOf('export async function getPurchaseCommitmentReport'));
    expect(reportRegion).toMatch(/commercial_suppliers supplier/);
    expect(reportRegion).toMatch(/supplier\.organisation_id = cpo\.organisation_id/);
    expect(reportRegion).toMatch(/commercial_cost_centres effective_cc/);
    expect(reportRegion).toMatch(/effective_cc\.organisation_id = cpo\.organisation_id/);
    expect(reportRegion).toMatch(/COALESCE\(cpol\.cost_centre_id, cpo\.cost_centre_id\)/);
  });
});
