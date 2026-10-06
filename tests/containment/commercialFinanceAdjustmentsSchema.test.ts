import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/create-commercial-finance-adjustments.sql'),
  'utf8',
);
const domain = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/financeAdjustments.ts'),
  'utf8',
);
const closeDomain = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/financeClose.ts'),
  'utf8',
);

describe('C7.9B — finance adjustment schema/domain contract', () => {
  it('creates DRAFT/POSTED/REVERSED adjustment headers and signed BIGINT lines', () => {
    expect(migration).toContain("status IN ('DRAFT','POSTED','REVERSED')");
    expect(migration).toContain('amount_exclusive_cents       BIGINT NOT NULL');
    expect(migration).toContain('tax_cents                    BIGINT NOT NULL');
    expect(migration).toContain('amount_inclusive_cents       BIGINT NOT NULL');
    expect(migration).not.toMatch(/CHECK \(amount_(?:exclusive|inclusive)_cents >= 0/);
  });

  it('uses one sign convention and enforces inclusive = exclusive + tax', () => {
    expect(migration).toContain('positive increases effective Budget Actual; negative reduces it');
    expect(migration).toContain('amount_inclusive_cents = amount_exclusive_cents + tax_cents');
    expect(migration).not.toContain('direction');
  });

  it('structurally binds each line to the same tenant and effective period as its header', () => {
    expect(migration).toContain('UNIQUE (id, organisation_id, effective_financial_period_id)');
    expect(migration).toContain('FOREIGN KEY (adjustment_id, organisation_id, financial_period_id)');
    expect(migration).toContain('REFERENCES commercial_finance_adjustments(id, organisation_id, effective_financial_period_id)');
  });

  it('freezes Budget classification and tax basis on POST', () => {
    for (const field of [
      'resolved_budget_id', 'resolved_budget_version_id', 'resolved_budget_line_id',
      'resolved_tax_basis', 'budget_basis_cents',
    ]) expect(migration).toContain(field);
    expect(domain).toContain("WHEN 'EXCLUSIVE' THEN fal.amount_exclusive_cents");
    expect(domain).toContain('ELSE fal.amount_inclusive_cents');
  });

  it('requires reclassification journals to balance exactly in all tax components', () => {
    expect(domain).toContain("'UNBALANCED_RECLASSIFICATION'");
    expect(domain).toContain("SUM(fal.amount_exclusive_cents) <> 0");
    expect(domain).toContain("SUM(fal.tax_cents) <> 0");
    expect(domain).toContain("SUM(fal.amount_inclusive_cents) <> 0");
  });

  it('blocks posted monetary/content mutation and line mutation at the database layer', () => {
    expect(migration).toContain('posted finance adjustment content is immutable');
    expect(migration).toContain('posted finance adjustment lines are immutable');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON commercial_finance_adjustments');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON commercial_finance_adjustment_lines');
    expect(migration).toContain('finance adjustment events are immutable');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON commercial_finance_adjustment_events');
  });

  it('uses reversal + replacement instead of editing a posted journal', () => {
    expect(migration).toContain('reversal_of_adjustment_id');
    expect(migration).toContain('idx_commercial_finance_adjustments_one_reversal');
    expect(domain).toContain("SET status = 'REVERSED'");
    expect(domain).toContain('-fal.amount_exclusive_cents');
    expect(domain).toContain('-fal.tax_cents');
    expect(domain).toContain('-fal.amount_inclusive_cents');
  });

  it('writes durable CREATED/POSTED/REVERSED control events transactionally', () => {
    expect(migration).toContain('commercial_finance_adjustment_events');
    expect(migration).toContain("event_type IN ('CREATED','POSTED','REVERSED')");
    expect(domain).toContain("'CREATED'");
    expect(domain).toContain("'POSTED'");
    expect(domain).toContain("'REVERSED'");
  });

  it('prevents period close while a DRAFT adjustment targets that period', () => {
    expect(closeDomain).toContain("'DRAFT_ADJUSTMENTS_EXIST'");
    expect(closeDomain).toContain("draft_adjustment.status = 'DRAFT'");
  });
});
