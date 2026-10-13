import { act,cleanup,fireEvent,render,screen,within } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { LedgerEntryHistory } from '@/app/commercial/budgeting/external-gl/LedgerEntryHistory';
import { EMPTY_LEDGER_FILTERS } from '@/lib/commercial/ledgerEntryHistoryModel';
import { savedEntry } from '../../fixtures/commercialLedgerImport';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function reportFor(url:string,count=1){const query=new URL(url,'http://localhost').searchParams;return {scope:Object.fromEntries(Object.keys(EMPTY_LEDGER_FILTERS).map(key=>[key,query.get(key)??''])),page:Number(query.get('page')??1),pageSize:25,totalCount:count,entries:count?[savedEntry]:[],totals:count?[{currency:'AUD',entryCount:count,amountCents:'-9007199254740993'}]:[]};}
describe('Read-only ledger history review',()=>{
  it('shows exact saved amounts, Australian dates, evidence and a page-scoped export',async()=>{
    const fetcher=vi.fn<(url:string,options?:RequestInit)=>Promise<Response>>().mockImplementation(async url=>Response.json({report:reportFor(url)}));vi.stubGlobal('fetch',fetcher);render(<LedgerEntryHistory revision={0}/>);
    const table=within(await screen.findByRole('region',{name:'Saved ledger history table'}));expect(table.getByText('-$90,071,992,547,409.93')).toBeVisible();expect(table.getByText('10/09/2026')).toBeVisible();
    fireEvent.click(table.getByRole('button',{name:'View evidence entry-1'}));const detail=within(screen.getByRole('region',{name:'Ledger source evidence'}));expect(detail.getByText('batch-1')).toBeVisible();expect(detail.getByText(savedEntry.source_payload_hash)).toBeVisible();
    expect(screen.getByRole('link',{name:'Export displayed page CSV'})).toHaveAttribute('download','ledger-history-page-1.csv');expect(screen.getByText(/CSV includes this displayed page only/)).toBeVisible();expect(fetcher.mock.calls.every(call=>call[1]?.method===undefined)).toBe(true);
  });
  it('applies exact filters, inclusive Australian date conversion and returns to page one',async()=>{
    const fetcher=vi.fn(async(url:string)=>Response.json({report:reportFor(url)}));vi.stubGlobal('fetch',fetcher);render(<LedgerEntryHistory revision={0}/>);await screen.findByRole('link',{name:'Export displayed page CSV'});
    fireEvent.change(screen.getByLabelText('History ledger source'),{target:{value:'XERO'}});fireEvent.change(screen.getByLabelText('Transaction date from'),{target:{value:'10/09/2026'}});fireEvent.change(screen.getByLabelText('Transaction date to'),{target:{value:'10/09/2026'}});
    expect(screen.queryByRole('link',{name:'Export displayed page CSV'})).not.toBeInTheDocument();fireEvent.submit(screen.getByRole('form',{name:'Filter ledger history'}));await screen.findByRole('link',{name:'Export displayed page CSV'});
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('source=XERO');expect(fetcher.mock.calls.at(-1)?.[0]).toContain('from=2026-09-10&to=2026-09-10&page=1');
  });
  it('does not fetch when draft dates are invalid',async()=>{
    const fetcher=vi.fn(async(url:string)=>Response.json({report:reportFor(url)}));vi.stubGlobal('fetch',fetcher);render(<LedgerEntryHistory revision={0}/>);await screen.findByRole('link',{name:'Export displayed page CSV'});
    fireEvent.change(screen.getByLabelText('Transaction date from'),{target:{value:'31/02/2026'}});fireEvent.submit(screen.getByRole('form',{name:'Filter ledger history'}));expect(screen.getByRole('alert')).toHaveTextContent('valid date');expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['network','malformed','wrong-scope'])('withholds stale details and exports after %s, then reloads through GET',async failure=>{
    let broken=false;const fetcher=vi.fn(async(url:string)=>{if(broken&&failure==='network')throw new Error('Network failure');return Response.json({report:broken?failure==='malformed'?{...reportFor(url),totals:null}:{...reportFor(url),scope:{...EMPTY_LEDGER_FILTERS,source:'OTHER'}}:reportFor(url)});});vi.stubGlobal('fetch',fetcher);render(<LedgerEntryHistory revision={0}/>);await screen.findByRole('link',{name:'Export displayed page CSV'});
    fireEvent.click(screen.getByRole('button',{name:'View evidence entry-1'}));broken=true;fireEvent.click(screen.getByRole('button',{name:'Reload ledger history'}));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:'Export displayed page CSV'})).not.toBeInTheDocument();expect(screen.queryByRole('region',{name:'Ledger source evidence'})).not.toBeInTheDocument();
    broken=false;fireEvent.click(screen.getByRole('button',{name:'Reload ledger history'}));await screen.findByRole('link',{name:'Export displayed page CSV'});expect(fetcher.mock.calls.every(call=>call[0].includes('entry-history?'))).toBe(true);
  });
  it('shows empty saved results without treating a failed read as empty',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json({report:reportFor(url,0)})));render(<LedgerEntryHistory revision={0}/>);await screen.findByText('No saved entries match these filters.');expect(screen.queryByRole('link',{name:'Export displayed page CSV'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Next ledger page'})).toBeDisabled();
  });
  it('paginates saved rows while retaining all-matching currency totals and changing export page',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const report=reportFor(url,26);report.entries=report.page===1?Array.from({length:25},(_,index)=>({...savedEntry,id:`row-${index}`,external_entry_id:`entry-${index}`})):[savedEntry];return Response.json({report});}));
    render(<LedgerEntryHistory revision={0}/>);await screen.findByText(/25 displayed of 26 matching/);fireEvent.click(screen.getByRole('button',{name:'Next ledger page'}));
    await screen.findByText(/1 displayed of 26 matching/);expect(screen.getByRole('link',{name:'Export displayed page CSV'})).toHaveAttribute('download','ledger-history-page-2.csv');expect(screen.getByRole('button',{name:'Next ledger page'})).toBeDisabled();expect(screen.getByRole('region',{name:'Matching ledger totals'})).toHaveTextContent('26 matching entries');
  });
  it('reloads after a new import revision and ignores the superseded response',async()=>{
    let first!:(response:Response)=>void;let calls=0;const fetcher=vi.fn((url:string)=>++calls===1?new Promise<Response>(done=>{first=done;}):Promise.resolve(Response.json({report:reportFor(url)})));vi.stubGlobal('fetch',fetcher);const view=render(<LedgerEntryHistory revision={0}/>);view.rerender(<LedgerEntryHistory revision={1}/>);await screen.findByRole('link',{name:'Export displayed page CSV'});
    await act(async()=>first(Response.json({report:{...reportFor('http://localhost'),totalCount:0,entries:[],totals:[]}})));expect(screen.queryByText('No saved entries match these filters.')).not.toBeInTheDocument();
  });
  it('withholds export during a fresh Apply even when filter values have not changed',async()=>{
    let calls=0;let resolve!:(response:Response)=>void;
    vi.stubGlobal('fetch',vi.fn((url:string)=>++calls===1?Promise.resolve(Response.json({report:reportFor(url)})):new Promise<Response>(done=>{resolve=done;})));
    render(<LedgerEntryHistory revision={0}/>);await screen.findByRole('link',{name:'Export displayed page CSV'});fireEvent.submit(screen.getByRole('form',{name:'Filter ledger history'}));
    expect(screen.queryByRole('link',{name:'Export displayed page CSV'})).not.toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await act(async()=>resolve(Response.json({report:reportFor('http://localhost')})));await screen.findByRole('link',{name:'Export displayed page CSV'});
  });
});
