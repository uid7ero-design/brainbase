import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSupplierRemittancePdf } from '@/lib/commercial/supplierRemittancePdf';
import type { SupplierRemittanceDocument } from '@/lib/commercial/supplierRemittanceDocument';
const sql = vi.fn();
vi.mock('@/lib/db', () => ({ default: (...args: unknown[]) => sql(...args) }));
const { getSupplierRemittanceDocument } = await import('@/lib/commercial/supplierRemittanceDocument');
const fixture = (): SupplierRemittanceDocument => ({payment_id:'00000000-0000-0000-0000-000000000101',organisation_name:'Integration purchaser',supplier_name:'A supplier with a long name '.repeat(4),
  currency:'AUD',amount_cents:'2147483647',method:'BANK_TRANSFER',reference:'Remittance reference '.repeat(10),paid_at:'2026-10-05T00:00:00Z',status:'RECORDED',reversed_at:null,reversal_reason:null,
  allocations:[{bill_id:'bill1',bill_number:'SB1',supplier_invoice_number:'INV1',allocated_amount_cents:'2147483646'},{bill_id:'bill2',bill_number:'SB2',supplier_invoice_number:'INV2',allocated_amount_cents:'1'}]});
beforeEach(() => sql.mockReset());
describe('Supplier remittance document', () => {
  it('reads once with tenant, supplier and currency joins and explicit public fields', async () => {
    sql.mockResolvedValue([fixture()]); expect(await getSupplierRemittanceDocument('org-a','payment')).toEqual(fixture());
    expect(sql).toHaveBeenCalledTimes(1);
    const [strings,...values] = sql.mock.calls[0]; const query = strings.join('?');
    expect(values).toEqual(['org-a','payment']); expect(query).toContain('a.organisation_id=p.organisation_id'); expect(query).toContain('a.supplier_id=p.supplier_id AND a.currency=p.currency');
    expect(query).not.toContain('p.*'); expect(query).not.toContain('request_hash'); expect(query).not.toContain('provider_reference');
  });
  it('returns null for absent/foreign tenant payments and fails closed on missing or inconsistent allocations', async () => {
    sql.mockResolvedValue([]); expect(await getSupplierRemittanceDocument('other','payment')).toBeNull();
    const data = fixture(); data.allocations = []; sql.mockResolvedValue([data]); await expect(getSupplierRemittanceDocument('org-a','payment')).rejects.toThrow('reconcile');
    data.allocations = fixture().allocations; data.amount_cents = '1'; await expect(getSupplierRemittanceDocument('org-a','payment')).rejects.toThrow('reconcile');
  });
  it('renders exact allocation amounts and clearly labels recorded and reversed multipage PDFs', () => {
    mkdirSync('test-results/ap-downloads',{recursive:true});
    const recorded = buildSupplierRemittancePdf(fixture());
    const text = Buffer.from(recorded).toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true); expect(text).toContain('21,474,836.47'); expect(text).toContain('Invoice INV2');
    writeFileSync('test-results/ap-downloads/long-recorded.pdf', recorded);
    const data = fixture(); data.status='REVERSED'; data.reversed_at='2026-10-06T00:00:00Z'; data.reversal_reason='Entire remittance corrected. '.repeat(20);
    data.amount_cents='100'; data.allocations=Array.from({length:100},(_,n)=>({bill_id:`bill${n}`,bill_number:`SB${n}`,supplier_invoice_number:`Invoice ${n}: a long supplier reference `.repeat(3),allocated_amount_cents:'1'}));
    const reversed = buildSupplierRemittancePdf(data); const reversedText = Buffer.from(reversed).toString('latin1');
    expect((reversedText.match(/REVERSED - NO ACTIVE SETTLEMENT/g) ?? []).length).toBeGreaterThan(2);
    expect(reversedText).toContain('Invoice 99:'); expect(reversedText).toContain('Original payment total');
    writeFileSync('test-results/ap-downloads/long-reversed.pdf', reversed);
  });
});
