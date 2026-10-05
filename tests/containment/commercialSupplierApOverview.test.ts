import { describe, expect, it, vi } from 'vitest';
import { AP_AGING_BUCKETS, agingBucket, buildSupplierApOverview, calendarDay, type ApBillInput } from '@/lib/commercial/supplierApOverviewModel';
const sql = vi.fn();
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sql(...args) }));
const bill = (changes: Partial<ApBillInput> = {}): ApBillInput => ({ supplier_id: 's1', supplier_name: 'Supplier', supplier_active: false,
  bill_id: 'b1', bill_number: 'SB1', supplier_invoice_number: 'INV1', due_date: '2026-10-05', currency: 'AUD', payable_cents: '10000', paid_cents: '2500', ...changes });
describe('Supplier AP overview foundation', () => {
  it.each(['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-01', '0000-01-01', '2026-10-05T00:00:00Z'])('rejects invalid calendar date %s', date => {
    expect(() => calendarDay(date)).toThrow('Invalid calendar date');
  });
  it('uses calendar days across leap day and daylight saving', () => {
    expect(calendarDay('2024-03-01') - calendarDay('2024-02-28')).toBe(2);
    expect(calendarDay('2026-10-05') - calendarDay('2026-10-04')).toBe(1);
  });
  it.each([[0, 'CURRENT'], [1, 'DAYS_1_30'], [30, 'DAYS_1_30'], [31, 'DAYS_31_60'], [60, 'DAYS_31_60'],
    [61, 'DAYS_61_90'], [90, 'DAYS_61_90'], [91, 'DAYS_91_PLUS']])('classifies %s days overdue', (days, bucket) => {
    const due = new Date(Date.UTC(2026, 9, 5) - Number(days) * 86400000).toISOString().slice(0, 10);
    expect(agingBucket(due, '2026-10-05')).toBe(bucket);
  });
  it('keeps future and missing due dates distinct', () => {
    expect(agingBucket('2026-10-06', '2026-10-05')).toBe('CURRENT');
    expect(agingBucket(null, '2026-10-05')).toBe('NO_DUE_DATE');
  });
  it('reconciles supplier totals, includes inactive suppliers, and separates currencies', () => {
    const report = buildSupplierApOverview([bill(), bill({ bill_id: 'b2', due_date: null }), bill({ bill_id: 'b3', currency: 'USD', due_date: '2026-09-01' })], '2026-10-05');
    expect(report.suppliers).toHaveLength(2);
    const aud = report.currencies.find(row => row.currency === 'AUD')!;
    expect(aud.payable_cents).toBe('20000'); expect(aud.paid_cents).toBe('5000'); expect(aud.outstanding_cents).toBe('15000');
    expect(aud.overdue_cents).toBe('0');
    expect(AP_AGING_BUCKETS.reduce((sum, key) => sum + BigInt(aud.buckets[key]), BigInt(0))).toBe(BigInt(aud.outstanding_cents));
    expect(report.suppliers[0].supplier_active).toBe(false);
    expect(report.currencies[1].overdue_cents).toBe('7500');
  });
  it('preserves aggregate precision beyond integer and JS safe-number limits', () => {
    const report = buildSupplierApOverview([bill({ payable_cents: '9007199254740991', paid_cents: '0' }), bill({ bill_id: 'b2', payable_cents: '2', paid_cents: '0' })], '2026-10-05');
    expect(report.currencies[0].payable_cents).toBe('9007199254740993');
  });
  it('fully paid and zero bills have no outstanding aging amount', () => {
    const report = buildSupplierApOverview([bill({ paid_cents: '10000' }), bill({ payable_cents: '0', paid_cents: '0' })], '2026-10-05');
    expect(report.currencies[0].outstanding_bill_count).toBe(0);
    expect(report.currencies[0].outstanding_cents).toBe('0');
  });
  it('fails on overpaid or malformed data rather than hiding it', () => {
    expect(() => buildSupplierApOverview([bill({ paid_cents: '10001' })], '2026-10-05')).toThrow('negative');
    expect(() => buildSupplierApOverview([bill({ payable_cents: '1.5' })], '2026-10-05')).toThrow('Invalid AP amount');
  });
  it('queries once with tenant-scoped active allocation preaggregation and POSTED bills', async () => {
    sql.mockResolvedValueOnce([bill()]);
    const { getSupplierApOverview } = await import('@/lib/commercial/supplierApOverview');
    await getSupplierApOverview('org-a', '2026-10-05');
    expect(sql).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sql.mock.calls[0];
    expect(values).toEqual(['org-a', 'org-a']);
    const query = strings.join('?');
    expect(query).toContain("p.status = 'RECORDED'"); expect(query).toContain("b.status = 'POSTED'");
    expect(query).toContain('GROUP BY a.supplier_bill_id, a.organisation_id');
    expect(query).toContain('b.due_date::text');
    expect(query).not.toContain('commercial_finance');
  });
});
