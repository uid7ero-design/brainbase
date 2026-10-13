import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'csv-parse/sync';
import { EMPTY_LEDGER_FILTERS, buildLedgerHistoryPageCsv, parseLedgerHistoryReport, validateLedgerHistoryFilters } from '@/lib/commercial/ledgerEntryHistoryModel';
import { savedEntry } from '../fixtures/commercialLedgerImport';
const sqlMock=vi.fn(),authMock=vi.fn();
vi.mock('@/lib/db',()=>({default:(...args:unknown[])=>sqlMock(...args)}));
vi.mock('@/lib/commercial/authorize',async original=>({...await original<typeof import('@/lib/commercial/authorize')>(),authorizeCommercialRequest:(...args:unknown[])=>authMock(...args)}));
const {listLedgerEntryHistory}=await import('@/lib/commercial/ledgerEntryHistory');
const {GET}=await import('@/app/api/commercial/budgeting/external-gl/entry-history/route');
const report={scope:EMPTY_LEDGER_FILTERS,page:1,pageSize:25,totalCount:1,entries:[savedEntry],totals:[{currency:'AUD',entryCount:1,amountCents:'-9007199254740993'}]};
beforeEach(()=>{sqlMock.mockReset();authMock.mockReset();});
describe('Ledger history scope, snapshot and CSV boundaries',()=>{
  it('keeps exact signed aggregate and date-only entry evidence',()=>{expect(parseLedgerHistoryReport(report,EMPTY_LEDGER_FILTERS,1)).toEqual(report);});
  it.each([{entries:null},{totals:null},{totalCount:0},{page:2},{pageSize:50},{entries:[]},{entries:[savedEntry,savedEntry]},{totals:[{currency:'AUD',entryCount:2,amountCents:'0'}]},{scope:{...EMPTY_LEDGER_FILTERS,source:'other'}}])('rejects incomplete or inconsistent snapshot %j',change=>expect(()=>parseLedgerHistoryReport({...report,...change},EMPTY_LEDGER_FILTERS,1)).toThrow());
  it.each([{source:'other'},{account:'other'},{currency:'USD'},{from:'2026-09-11'},{to:'2026-09-09'}])('rejects a row outside applied scope %j',change=>{const scope={...EMPTY_LEDGER_FILTERS,...change};expect(()=>parseLedgerHistoryReport({...report,scope},scope,1)).toThrow();});
  it('accepts explicit empty results without fabricating a zero currency group',()=>expect(parseLedgerHistoryReport({...report,totalCount:0,entries:[],totals:[]},EMPTY_LEDGER_FILTERS,1).totals).toEqual([]));
  it('checks last-page size against matching count and permits an out-of-range empty page',()=>{
    expect(parseLedgerHistoryReport({...report,page:2,totalCount:26,totals:[{currency:'AUD',entryCount:26,amountCents:'0'}]},EMPTY_LEDGER_FILTERS,2).entries).toHaveLength(1);
    expect(parseLedgerHistoryReport({...report,page:3,entries:[]},EMPTY_LEDGER_FILTERS,3).entries).toEqual([]);
  });
  it('keeps currency sums separate and permits exact totals beyond single-row BIGINT bounds',()=>{
    const second={...savedEntry,id:'usd-entry',currency:'USD'};
    expect(parseLedgerHistoryReport({...report,totalCount:2,entries:[savedEntry,second],totals:[{currency:'AUD',entryCount:1,amountCents:'-18446744073709551616'},{currency:'USD',entryCount:1,amountCents:'1'}]},EMPTY_LEDGER_FILTERS,1).totals).toHaveLength(2);
  });
  it.each([{from:'2026-02-31'},{from:'2026-09-11',to:'2026-09-10'},{currency:'AU'},{source:'x'.repeat(301)}])('rejects invalid filters %j',change=>expect(()=>validateLedgerHistoryFilters({...EMPTY_LEDGER_FILTERS,...change})).toThrow());
  it('exports the displayed page with exact cents, lineage and spreadsheet-safe text',()=>{
    const csv=buildLedgerHistoryPageCsv({...report,entries:[{...savedEntry,description:'  =SUM(1,2)',external_journal_id:'@journal'}]});
    const rows=parse(csv,{columns:true});expect(rows).toHaveLength(1);expect(rows[0]['Description']).toBe("'  =SUM(1,2)");expect(rows[0]['Journal']).toBe("'@journal");
    expect(rows[0]['Amount cents']).toContain('-9007199254740993');expect(rows[0]['Transaction date']).toBe('2026-09-10');expect(rows[0]['Source lineage']).toBe('batch-1');
  });
  it.each([401,403,503])('preserves authorization denial %s before a history query',async status=>{
    authMock.mockResolvedValue({ok:false,response:new Response(null,{status})});expect((await GET(new Request('http://localhost'))).status).toBe(status);expect(sqlMock).not.toHaveBeenCalled();expect(authMock).toHaveBeenCalledWith('budgeting','admin');
  });
  it.each(['page=0','page=1e2','page=100001','from=2026-02-31','currency=AU'])('rejects invalid query %s',async query=>{
    authMock.mockResolvedValue({ok:true,session:{organisationId:'org-a'}});expect((await GET(new Request('http://localhost?'+query))).status).toBe(400);expect(sqlMock).not.toHaveBeenCalled();
  });
  it('uses a single tenant-bound statement for page, count and all matching totals',async()=>{
    sqlMock.mockResolvedValue([{total_count:26,entries:[savedEntry],totals:report.totals}]);await listLedgerEntryHistory('org-a',{...EMPTY_LEDGER_FILTERS,source:'XERO',from:'2026-09-10',to:'2026-09-10'},2);
    const [strings,...values]=sqlMock.mock.calls[0];expect(values[0]).toBe('org-a');expect(values).toContain('XERO');expect(values).toContain(25);expect(sqlMock).toHaveBeenCalledOnce();
    const query=strings.join('?');expect(query).toContain('WHERE organisation_id=?');expect(query).toContain('SUM(amount_minor_units)::text');expect(query).toContain('ORDER BY transaction_date DESC,imported_at DESC,id DESC');expect(query).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
  it('derives tenant from session and returns no-store history',async()=>{
    authMock.mockResolvedValue({ok:true,session:{organisationId:'org-a'}});sqlMock.mockResolvedValue([{total_count:0,entries:[],totals:[]}]);const response=await GET(new Request('http://localhost?organisationId=foreign'));
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');expect(sqlMock.mock.calls[0][1]).toBe('org-a');
  });
});
