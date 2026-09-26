import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({ default: sqlMock }));

const { deriveBudgetActualLine, deriveBudgetActualReport, getBudgetActualReport } =
  await import('@/lib/commercial/budgetActuals');

import type { RawBudgetActualRow } from '@/lib/commercial/budgetActuals';

const raw = (overrides: Partial<RawBudgetActualRow> = {}): RawBudgetActualRow => ({
  supplier_bill_line_id: 'sbl-1',
  supplier_bill_id: 'sb-1',
  supplier_bill_number: 'BILL-0001',
  supplier_id: 'sup-1',
  supplier_name: 'Supplier One',
  source_purchase_order_id: 'po-1',
  source_purchase_order_line_id: 'pol-1',
  bill_currency: 'AUD',
  purchase_order_currency: 'AUD',
  posted_at: '2026-09-15T12:00:00.000Z',
  line_subtotal_cents: '10000',
  line_tax_cents: '1000',
  line_total_cents: '11000',
  effective_cost_centre_id: 'cc-1',
  effective_cost_centre_code: 'OPS',
  effective_cost_centre_name: 'Operations',
  period_match_count: 1,
  financial_period_id: 'fp-1',
  financial_period_name: 'September 2026',
  financial_period_status: 'OPEN',
  financial_year_id: 'fy-1',
  financial_year_name: 'FY2026-27',
  ...overrides,
});

beforeEach(() => sqlMock.mockReset());

describe('C7.8A — derived Budget Actual domain', () => {
  it('derives an exact POSTED supplier-bill-line Actual fact without choosing a Budget tax basis', () => {
    const actual = deriveBudgetActualLine(raw());
    expect(actual).toMatchObject({
      supplierBillLineId: 'sbl-1',
      recognisedAt: '2026-09-15T12:00:00.000Z',
      periodResolution: 'RESOLVED',
      financialPeriodId: 'fp-1',
      effectiveCostCentreId: 'cc-1',
      subtotalCents: 10000,
      taxCents: 1000,
      totalCents: 11000,
      exceptionCodes: [],
    });
  });

  it.each([
    [0, 'UNRESOLVED', 'UNRESOLVED_PERIOD'],
    [2, 'AMBIGUOUS', 'AMBIGUOUS_PERIOD'],
  ] as const)('maps period match count %s to %s and %s', (count, resolution, code) => {
    const actual = deriveBudgetActualLine(raw({ period_match_count: count }));
    expect(actual.periodResolution).toBe(resolution);
    expect(actual.exceptionCodes).toContain(code);
    expect(actual.financialPeriodId).toBeNull();
    expect(actual.financialYearId).toBeNull();
  });

  it('surfaces a missing effective cost centre without inventing attribution', () => {
    const actual = deriveBudgetActualLine(raw({
      effective_cost_centre_id: null,
      effective_cost_centre_code: null,
      effective_cost_centre_name: null,
    }));
    expect(actual.exceptionCodes).toContain('UNATTRIBUTED_COST_CENTRE');
    expect(actual.effectiveCostCentreId).toBeNull();
  });

  it('fails loud when a POSTED source row has no posted_at', () => {
    const actual = deriveBudgetActualLine(raw({ posted_at: null, period_match_count: 0 }));
    expect(actual.exceptionCodes).toEqual(expect.arrayContaining(['MISSING_POSTED_AT', 'UNRESOLVED_PERIOD']));
  });

  it('surfaces source currency drift between supplier bill and purchase order', () => {
    const actual = deriveBudgetActualLine(raw({ bill_currency: 'USD' }));
    expect(actual.exceptionCodes).toContain('SOURCE_CURRENCY_MISMATCH');
    expect(actual.currency).toBe('USD');
  });

  it('rejects money outside the JavaScript safe-integer range', () => {
    expect(() => deriveBudgetActualLine(raw({ line_total_cents: '9007199254740992' })))
      .toThrow('safe integer');
  });

  it('aggregates source amounts by currency without combining currencies', () => {
    const result = deriveBudgetActualReport([
      raw(),
      raw({ supplier_bill_line_id: 'sbl-2', line_subtotal_cents: '500', line_tax_cents: '50', line_total_cents: '550' }),
      raw({ supplier_bill_line_id: 'sbl-3', bill_currency: 'USD', purchase_order_currency: 'USD', line_subtotal_cents: '200', line_tax_cents: '0', line_total_cents: '200' }),
    ]);
    expect(result.lineCount).toBe(3);
    expect(result.currencies).toEqual([
      { currency: 'AUD', lineCount: 2, subtotalCents: 10500, taxCents: 1050, totalCents: 11550 },
      { currency: 'USD', lineCount: 1, subtotalCents: 200, taxCents: 0, totalCents: 200 },
    ]);
  });

  it('counts exception-bearing lines without dropping their monetary source facts', () => {
    const result = deriveBudgetActualReport([
      raw({ effective_cost_centre_id: null }),
      raw({ supplier_bill_line_id: 'sbl-2' }),
    ]);
    expect(result).toMatchObject({ lineCount: 2, exceptionLineCount: 1, resolvedPeriodCount: 2 });
    expect(result.lines[0].totalCents).toBe(11000);
  });
});

describe('C7.8A — tenant-scoped Actual SQL contract', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'lib/commercial/budgetActuals.ts'), 'utf8');

  it('roots the read in POSTED supplier bills and uses posted_at for period attribution', () => {
    expect(source).toMatch(/FROM commercial_supplier_bill_lines sbl[\s\S]*?JOIN commercial_supplier_bills sb/);
    expect(source).toMatch(/sb\.status = 'POSTED'/);
    expect(source).toMatch(/sb\.posted_at::date BETWEEN fp\.starts_on AND fp\.ends_on/);
    expect(source).not.toMatch(/bill_date::date BETWEEN/);
  });

  it('scopes bill line, bill, PO line, PO, cost centre and financial periods to the tenant', () => {
    for (const fragment of [
      'sbl.organisation_id = ${organisationId}',
      'sb.organisation_id = ${organisationId}',
      'pol.organisation_id = ${organisationId}',
      'po.organisation_id = ${organisationId}',
      'cc.organisation_id = sbl.organisation_id',
      'fp.organisation_id = sbl.organisation_id',
      'fy.organisation_id = fp.organisation_id',
    ]) expect(source).toContain(fragment);
  });

  it('uses PO-line cost centre before PO-header fallback', () => {
    expect(source).toContain('COALESCE(pol.cost_centre_id, po.cost_centre_id)');
  });

  it('does not read receipts, match allocations, customer payments or legacy financial_models', () => {
    const start = source.indexOf('export async function getBudgetActualReport');
    const body = source.slice(start);
    expect(body).not.toMatch(/purchase_receipt/i);
    expect(body).not.toMatch(/match_alloc/i);
    expect(body).not.toMatch(/commercial_payments/i);
    expect(body).not.toMatch(/financial_models/i);
  });

  it('returns the pure derived report from the tenant-scoped rows', async () => {
    sqlMock.mockResolvedValueOnce([raw()]);
    const result = await getBudgetActualReport('org-a');
    expect(result.lineCount).toBe(1);
    expect(result.lines[0].supplierBillLineId).toBe('sbl-1');
  });
});
