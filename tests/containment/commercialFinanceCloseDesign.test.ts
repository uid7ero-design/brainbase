import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const design = fs.readFileSync(
  path.resolve(process.cwd(), 'docs/architecture/c7-9-finance-close-reconciliation-design.md'),
  'utf8',
);
const periods = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/financialPeriods.ts'),
  'utf8',
);
const supplierBills = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/supplierBills.ts'),
  'utf8',
);
const actualDesign = fs.readFileSync(
  path.resolve(process.cwd(), 'docs/architecture/c7-8-budget-actuals-design.md'),
  'utf8',
);
const closeMigration = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/create-commercial-finance-close.sql'),
  'utf8',
);

describe('C7.9 — finance reconciliation and close-control architecture contract', () => {
  it('hardens the old OPEN/CLOSED primitive behind durable close controls', () => {
    expect(periods).toContain("export type FinancialStatus = 'OPEN' | 'CLOSED'");
    expect(periods).toContain('Direct financial-period status changes are disabled');
    expect(periods).not.toContain('UPDATE commercial_financial_periods SET status');
    expect(design).toContain("today's CLOSED flag as the starting primitive, not a complete accounting close");
    expect(design).toContain('durable close record');
  });

  it('never rewrites source recognition dates or adopts a mutable supplier-bill accounting_date', () => {
    expect(design).toContain('Source commercial facts are never backdated or rewritten');
    expect(design).toContain('supplier_bill.posted_at is immutable recognition evidence');
    expect(design).toContain('does **not** approve a mutable accounting_date column on supplier bills');
    expect(design).toContain('Do not add mutable accounting_date to commercial_supplier_bills');
    expect(actualDesign).toContain('recognition date is posted_at');
  });

  it('treats CLOSED finance periods as sealed and requires explicit reopen control', () => {
    expect(design).toContain('A financially CLOSED period is a sealed attribution period');
    expect(design).toContain('Automatic reopen is prohibited');
    expect(design).toContain('mandatory reason');
    expect(design).toContain('invalidates the prior close sign-off');
  });

  it('makes financial-year close durable and reopen append-only', () => {
    expect(design).toContain('commercial_financial_year_closes');
    expect(design).toContain('monotonically increasing close sequence');
    expect(design).toContain('Historical year-close records are never deleted');
    expect(design).toContain('Year reopen requires an explicit reason');
    expect(design).toContain('Reclose appends the next sequence');
    expect(periods).toContain('export async function listFinancialYearCloses');
    expect(periods).toContain("'C7_9_YEAR_CLOSE'");
    expect(periods).not.toMatch(/DELETE FROM commercial_financial_year_closes/);
  });

  it('keeps ordinary late supplier bills in their real posted_at period without automatic backdating', () => {
    expect(design).toContain('late supplier bill');
    expect(design).toContain('recognise the operational payable Actual in the period containing posted_at');
    expect(design).toContain('do not automatically backdate');
    expect(design).toContain('LATE_BILL_CLOSED_PERIOD');
  });

  it('selects append-only adjustment journals and reversal rather than mutation', () => {
    expect(design).toContain('append-only adjustment journal');
    expect(design).toContain('POSTED rows are immutable');
    expect(design).toContain('Corrections use reversal + replacement');
    expect(design).toContain('effective Budget Actual = source payable Actual + POSTED finance adjustment lines');
  });

  it('prevents hard deletion of durable close history at the database layer', () => {
    expect(closeMigration).toContain('commercial_financial_period_close_delete_guard');
    expect(closeMigration).toContain("RAISE EXCEPTION 'finance close history is immutable'");
    expect(closeMigration).toContain('BEFORE DELETE ON commercial_financial_period_closes');
  });

  it('requires transactional close evidence rather than relying on best-effort audit only', () => {
    expect(design).toContain('A best-effort audit event alone is insufficient for close integrity');
    expect(design).toContain('finance close record is the durable control evidence');
    expect(design).toContain('control evidence must be transactionally durable');
  });

  it('keeps Budget accounts distinct from external statutory GL accounts and forbids fuzzy mapping', () => {
    expect(design).toContain('Budget account is not statutory GL account');
    expect(design).toContain('commercial_external_gl_account_mappings');
    expect(design).toContain('No fuzzy matching');
  });

  it('reconciles immutable BrainBase and GL facts instead of overwriting either authority', () => {
    expect(design).toContain('Neither system silently overwrites the other');
    expect(design).toContain('BrainBase source Actual + finance adjustments');
    expect(design).toContain('external GL journal/transaction facts');
    expect(design).toContain('Tolerance is **zero cents by default**');
  });

  it('makes prior sign-off stale rather than deleting history after reopen or external change', () => {
    expect(design).toContain('Reopening makes that sign-off stale');
    expect(design).toContain('STALE_AFTER_EXTERNAL_CHANGE');
    expect(design).toContain('it is never deleted');
  });

  it('preserves C7.8 operational Actual as a separately labelled source view', () => {
    expect(design).toContain('Source Actual — POSTED supplier-bill value');
    expect(design).toContain('Effective Actual — Source Actual + Finance adjustments');
    expect(design).toContain('Do not collapse these into one unlabeled "Actual"');
  });

  it('does not turn C7.9 into a statutory ledger implementation', () => {
    expect(design).toContain('does not implement');
    expect(design).toContain('a full statutory general ledger');
    expect(design).toContain('external ERP replacement');
    expect(supplierBills).toContain('posted_at = now()');
  });
});
