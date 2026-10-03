import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
}

const page = source('app/commercial/budgeting/finance-controls/page.tsx');
const sidebar = source('app/commercial/_components/CommercialSidebar.tsx');
const closeDomain = source('lib/commercial/financeClose.ts');

describe('C7.9 — Finance Controls admin UI', () => {
  it('is discoverable only through the existing Budgeting admin navigation gate', () => {
    expect(sidebar).toContain('budgetingAdminEnabled');
    expect(sidebar).toContain("'/commercial/budgeting/finance-controls'");
    expect(sidebar).toContain("label: 'Finance Controls'");
  });

  it('loads tenant-scoped period history, sources and latest reconciliation control state through server APIs', () => {
    expect(page).toContain("fetch('/api/commercial/budgeting/financial-periods'");
    expect(page).toContain("fetch('/api/commercial/budgeting/external-gl/sources'");
    expect(page).toContain('/api/commercial/budgeting/reconciliations/control-state?');
    expect(page).toContain("params.set('sourceSystemId', sourceSystemId)");
    expect(page).toContain("params.set('currency', currency.trim().toUpperCase())");
    expect(page).not.toMatch(/organisationId=/);
  });

  it('uses the newest current CLOSED record for sign-off rather than historical invalidated closes', () => {
    expect(closeDomain).toMatch(/ORDER BY close_sequence DESC/);
    expect(page).toContain("selectedPeriod?.closes.find(close => close.status === 'CLOSED')");
    expect(page).toContain('{ closeId: activeClose.id }');
    expect(page).toContain('A current CLOSED period record is required before sign-off.');
  });

  it('operates close and reopen only through the governed lifecycle endpoints', () => {
    expect(page).toContain('/financial-periods/');
    expect(page).toContain('/close');
    expect(page).toContain('/reopen');
    expect(page).toContain("if (!selectedPeriod || !reopenReason.trim())");
    expect(page).toContain('A reopen reason is required.');
    expect(page).toContain('Prior close evidence remains as invalidated history.');
    expect(page).not.toMatch(/DELETE FROM|UPDATE commercial_financial_period/i);
  });

  it('operates PREPARED -> REVIEWED -> SIGNED_OFF only through existing reconciliation APIs', () => {
    expect(page).toContain("postJson('/api/commercial/budgeting/reconciliations/prepare'");
    expect(page).toContain('/reconciliations/');
    expect(page).toContain('/review');
    expect(page).toContain('/sign-off');
    expect(page).toContain("reconciliation.status === 'PREPARED'");
    expect(page).toContain("reconciliation.status === 'REVIEWED'");
    expect(page).toContain('Read only');
  });

  it('requires explicit period, source and three-letter currency before preparing a snapshot', () => {
    expect(page).toContain("!/^[A-Z]{3}$/.test(cleanCurrency)");
    expect(page).toContain('Choose a period and source, and enter a three-letter currency code.');
    expect(page).toContain('financialPeriodId: effectiveSelectedPeriodId');
    expect(page).toContain('sourceSystemId');
    expect(page).toContain('currency: cleanCurrency');
    expect(page).toContain('notes: notes.trim() || null');
  });

  it('shows durable close history and exact reconciliation control measures without collapsing finance semantics', () => {
    expect(page).toContain('Durable close history');
    expect(page).toContain('Source Actual');
    expect(page).toContain('Finance Adjustments');
    expect(page).toContain('Effective Actual');
    expect(page).toContain('External GL');
    expect(page).toContain('Variance');
    expect(page).toContain('formatMoneyCentsExact(reconciliation.sourceActualCents');
    expect(page).toContain('formatMoneyCentsExact(reconciliation.financeAdjustmentCents');
    expect(page).toContain('formatMoneyCentsExact(reconciliation.externalGlTotalCents');
  });
});
