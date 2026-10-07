import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSupplierApCsv } from '@/lib/commercial/supplierApCsv';
import { buildSupplierApOverview } from '@/lib/commercial/supplierApOverviewModel';
const authorize = vi.fn(); const read = vi.fn(); const remittance = vi.fn(); const render = vi.fn();
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: (...args: unknown[]) => authorize(...args), COMMERCIAL_MIN_ROLE: { view: 'viewer' } }));
vi.mock('@/lib/commercial/supplierApOverview', () => ({ getSupplierApExport: (...args: unknown[]) => read(...args) }));
vi.mock('@/lib/commercial/supplierRemittanceDocument', () => ({ getSupplierRemittanceDocument: (...args: unknown[]) => remittance(...args) }));
vi.mock('@/lib/commercial/supplierRemittancePdf', () => ({ buildSupplierRemittancePdf: (...args: unknown[]) => render(...args) }));
const exports = await import('@/app/api/commercial/purchasing/ap-overview/export/route');
const pdf = await import('@/app/api/commercial/supplier-payments/[id]/remittance/route');
const id = '00000000-0000-0000-0000-000000000101';
const request = (query = '') => new Request(`http://localhost/?aging_date=2026-10-05${query}`);
const context = { params: Promise.resolve({ id }) };
const report = () => buildSupplierApOverview([{ supplier_id:id, supplier_name:'Supplier',supplier_active:false,bill_id:'b',bill_number:'SB1',supplier_invoice_number:'INV1',currency:'AUD',due_date:null,payable_cents:'9007199254740993',paid_cents:'1' }], '2026-10-05');
beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ ok:true,session:{organisationId:'org-a'} }); read.mockResolvedValue(report()); remittance.mockResolvedValue({status:'REVERSED'}); render.mockReturnValue(new Uint8Array([37,80,68,70])); });
describe('AP downloads', () => {
  it('exports the selected historical basis with explicit UTC metadata', async () => {
    read.mockResolvedValue({...report(),balance_basis:'HISTORICAL_RECORDED_BALANCE',as_of_timezone:'UTC'});
    const response = await exports.GET(request('&balance_basis=HISTORICAL_RECORDED_BALANCE&view=aging'));
    expect(read).toHaveBeenCalledWith('org-a','2026-10-05',expect.any(Object),'HISTORICAL_RECORDED_BALANCE');
    expect(response.headers.get('Content-Disposition')).toContain('supplier-ap-historical-aging');
    const csv = await response.text(); expect(csv).toContain('HISTORICAL_RECORDED_BALANCE'); expect(csv).toContain('Cutoff timezone'); expect(csv).toContain(',UTC\r\n');
  });
  it('rejects invalid historical basis and reports incomplete history without exporting partial rows', async () => {
    expect((await exports.GET(request('&balance_basis=BAD'))).status).toBe(400); expect(read).not.toHaveBeenCalled();
    read.mockRejectedValue(new Error('Supplier AP history is incomplete'));
    const response = await exports.GET(request('&balance_basis=HISTORICAL_RECORDED_BALANCE'));
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('AP_HISTORY_INCOMPLETE');
  });
  it('requires purchasing view before reading or rendering, with no-store responses', async () => {
    authorize.mockResolvedValue({ok:false,response:new Response(null,{status:403})});
    for (const response of [await exports.GET(request()),await pdf.GET(request(),context)]) {
      expect(response.status).toBe(403); expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(authorize).toHaveBeenCalledWith('purchasing','viewer'); expect(read).not.toHaveBeenCalled(); expect(remittance).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  });
  it('exports exact cents, preserves filters, ignores page parameters and uses the session tenant', async () => {
    const response = await exports.GET(request('&search=INV&currency=AUD&page=999&supplier_page=0&page_size=1&organisationId=other'));
    expect(response.status).toBe(200); expect(read).toHaveBeenCalledWith('org-a','2026-10-05',expect.objectContaining({search:'INV',currency:'AUD',page:1,supplierPage:1,pageSize:50}));
    expect(await response.text()).toContain('9007199254740993,1,9007199254740992');
    expect(response.headers.get('Content-Type')).toContain('text/csv'); expect(response.headers.get('Content-Disposition')).toContain('supplier-ap-bills-2026-10-05.csv'); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each(['&view=bad','&aging_date=bad&currency=aud','&bucket=BAD','&supplier_id=other'])('rejects invalid export filters %s', async query => {
    expect((await exports.GET(request(query))).status).toBe(400); expect(read).not.toHaveBeenCalled();
  });
  it('writes BOM, quoted multiline fields and protects whitespace-prefixed spreadsheet formulas', () => {
    const data = report(); data.bills[0].supplier_name = '\t =HYPERLINK("bad")'; data.bills[0].supplier_invoice_number = 'Invoice, "quoted"\nsecond line';
    const csv = buildSupplierApCsv(data,'bills');
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv).toContain('"\'\t =HYPERLINK(""bad"")"'); expect(csv).toContain('"Invoice, ""quoted""\nsecond line"'); expect(csv.endsWith('\r\n')).toBe(true);
    const aging = buildSupplierApCsv(data,'aging'); expect(aging).toContain('NO_DUE_DATE cents'); expect(aging).toContain('9007199254740992');
  });
  it('downloads recorded or reversed documents scoped to the session tenant', async () => {
    const response = await pdf.GET(request('&organisationId=other'),context);
    expect(remittance).toHaveBeenCalledWith('org-a',id); expect(render).toHaveBeenCalledWith({status:'REVERSED'});
    expect(response.headers.get('Content-Type')).toBe('application/pdf'); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toContain(id); expect(await response.text()).toBe('%PDF');
  });
  it('returns 404 for missing/foreign tenant payments and malformed IDs', async () => {
    remittance.mockResolvedValue(null); expect((await pdf.GET(request(),context)).status).toBe(404); expect(render).not.toHaveBeenCalled();
    remittance.mockClear(); expect((await pdf.GET(request(),{params:Promise.resolve({id:'invalid'})})).status).toBe(404); expect(remittance).not.toHaveBeenCalled();
  });
  it('keeps database and renderer failures private', async () => {
    read.mockRejectedValue(new Error('private')); remittance.mockRejectedValue(new Error('private'));
    for (const response of [await exports.GET(request()),await pdf.GET(request(),context)]) { expect(response.status).toBe(500); expect(await response.text()).not.toContain('private'); }
  });
});
