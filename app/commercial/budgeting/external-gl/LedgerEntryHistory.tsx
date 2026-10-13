'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { buttonProps, fieldControlClassName, tableStyles } from '@/components/ui/app';
import { australianDateToIso, formatAustralianDate, formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { EMPTY_LEDGER_FILTERS, buildLedgerHistoryPageCsv, parseLedgerHistoryReport, validateLedgerHistoryFilters, type LedgerHistoryFilters, type LedgerHistoryReport } from '@/lib/commercial/ledgerEntryHistoryModel';
import styles from './page.module.css';

const filterLabels: Array<[keyof LedgerHistoryFilters, string]> = [['source','History ledger source'],['account','History account code'],['currency','History currency'],['from','Transaction date from'],['to','Transaction date to']];
export function LedgerEntryHistory({ revision }: { revision: number }) {
  const [draft,setDraft] = useState({ ...EMPTY_LEDGER_FILTERS });
  const [scope,setScope] = useState({ ...EMPTY_LEDGER_FILTERS });
  const [page,setPage] = useState(1), [reload,setReload] = useState(0);
  const requestKey=JSON.stringify([scope,page,revision,reload]);
  const [result,setResult]=useState<{key:string;report:LedgerHistoryReport|null;error:string}>({key:'',report:null,error:''});
  const loading=result.key!==requestKey;
  const report=result.report;
  const error=loading?'':result.error;
  const [filterError,setFilterError]=useState('');
  const [selected,setSelected] = useState('');
  const serial = useRef(0);
  useEffect(() => {
    const sequence = ++serial.current; let current = true;
    async function load() {
      try {
        const query = new URLSearchParams({ ...scope, page:String(page) });
        const response = await fetch(`/api/commercial/budgeting/external-gl/entry-history?${query}`, { cache:'no-store' });
        if (!response.ok) throw new Error(response.status === 403 ? 'Budgeting administrator access is required to review ledger history.' : 'Unable to load saved ledger history.');
        const data = await response.json();
        const next = parseLedgerHistoryReport(data?.report,scope,page);
        if (current && sequence === serial.current) setResult({key:requestKey,report:next,error:''});
      } catch (failure) { if (current && sequence === serial.current) setResult({key:requestKey,report:null,error:failure instanceof Error ? failure.message : 'Unable to load saved ledger history.'}); }
    }
    void load(); return () => { current = false; };
  },[scope,page,requestKey]);
  function apply(event:FormEvent) {
    event.preventDefault();setFilterError('');
    try {
      const next = validateLedgerHistoryFilters({ ...draft,from:draft.from ? australianDateToIso(draft.from) : '',to:draft.to ? australianDateToIso(draft.to) : '' });
      setScope(next);setPage(1);setReload(value=>value+1);setDraft({ ...next,from:next.from ? formatAustralianDate(next.from) : '',to:next.to ? formatAustralianDate(next.to) : '' });
    } catch (failure) { setFilterError(failure instanceof Error ? failure.message : 'Check the history filters.'); }
  }
  const confirmed = !loading && !error && report && report.page === page && Object.keys(scope).every(key=>report.scope[key as keyof LedgerHistoryFilters]===scope[key as keyof LedgerHistoryFilters]);
  const displayScope = { ...scope,from:scope.from ? formatAustralianDate(scope.from) : '',to:scope.to ? formatAustralianDate(scope.to) : '' };
  const dirty = Object.keys(draft).some(key=>draft[key as keyof LedgerHistoryFilters]!==displayScope[key as keyof LedgerHistoryFilters]);
  const detail = confirmed ? report.entries.find(row=>row.id===selected) : undefined;
  return <section aria-label="Ledger entry history" style={{ background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0 }}>
    <h2 style={{ fontSize:16,marginTop:0 }}>Ledger entry history</h2>
    <p style={{ fontSize:12,color:'var(--text-muted)' }}>Review saved external ledger facts. Filters use exact source and account codes and inclusive transaction dates. Totals sum the signed amounts of all matching imported entries, separated by currency. History review does not post, reconcile or change entries.</p>
    <form aria-label="Filter ledger history" onSubmit={apply}><fieldset className={styles.mappingGrid} disabled={loading}>
      {filterLabels.map(([key,label])=><label key={key} style={{ display:'grid',gap:5,fontSize:12 }}>{label}
        <input value={draft[key]} maxLength={key==='from'||key==='to'?10:300} placeholder={key==='from'||key==='to'?'DD/MM/YYYY':'All'} onChange={event=>{setDraft(value=>({...value,[key]:event.target.value}));setFilterError('');}} className={fieldControlClassName}/>
      </label>)}
      <button type="submit" {...buttonProps('primary','sm')}>Apply history filters</button>
    </fieldset></form>
    {filterError?<p role="alert">{filterError}</p>:null}
    {dirty?<p style={{ fontSize:12 }}>Apply changed filters before exporting. The current view still uses the saved filter scope below.</p>:null}
    <div style={{ display:'flex',flexWrap:'wrap',gap:10,marginTop:12 }}>
      <button type="button" disabled={loading} onClick={()=>setReload(value=>value+1)} {...buttonProps('secondary','sm')}>Reload ledger history</button>
      <button type="button" disabled={loading} onClick={()=>{setDraft({...EMPTY_LEDGER_FILTERS});setScope({...EMPTY_LEDGER_FILTERS});setPage(1);setReload(value=>value+1);setFilterError('');}} {...buttonProps('secondary','sm')}>Clear history filters</button>
      {confirmed&&!dirty&&report.entries.length>0?<a download={`ledger-history-page-${report.page}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(buildLedgerHistoryPageCsv(report))}`} {...buttonProps('secondary','sm')}>Export displayed page CSV</a>:<button type="button" disabled {...buttonProps('secondary','sm')}>Export displayed page CSV</button>}
    </div>
    {loading?<p role="status">Loading saved ledger history…</p>:null}
    {error?<p role="alert">{error} Reload history to check the saved records. Export and details are unavailable until a complete read succeeds.</p>:null}
    {confirmed?<>
      <p style={{ fontSize:12,overflowWrap:'anywhere' }}>Applied scope: source {scope.source||'All'} · account {scope.account||'All'} · currency {scope.currency||'All'} · {displayScope.from||'Any start date'} to {displayScope.to||'Any end date'}.</p>
      <div aria-label="Matching ledger totals" role="region" style={{ display:'flex',flexWrap:'wrap',gap:16,margin:'12px 0',overflowWrap:'anywhere' }}>{report.totals.map(total=><div key={total.currency}><strong>{total.currency} {formatMoneyCentsExact(total.amountCents,total.currency)}</strong><div style={{ fontSize:12 }}>{total.entryCount} matching {total.entryCount===1?'entry':'entries'}</div></div>)}</div>
      <p style={{ fontSize:12 }}>Page {report.page} · {report.entries.length} displayed of {report.totalCount} matching entries. CSV includes this displayed page only; amounts are integer cents and dates are ISO calendar values.</p>
      <div role="region" aria-label="Saved ledger history table" tabIndex={0} style={{ overflowX:'auto' }}><table className={tableStyles.table} style={{ minWidth:900 }}>
        <thead><tr>{['Source','Entry','Transaction date','Account','Currency','Amount','Imported at','Evidence'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{report.entries.length===0?<tr><td colSpan={8}>No saved entries match these filters.</td></tr>:report.entries.map(row=><tr key={row.id}>
          <td>{row.source_system_id}</td><td>{row.external_entry_id}</td><td>{formatAustralianDate(row.transaction_date)}</td><td>{row.external_account_code}</td><td>{row.currency}</td><td className={tableStyles.num}>{formatMoneyCentsExact(row.amount_minor_units,row.currency)}</td><td>{formatAustralianTimestamp(row.imported_at)}</td>
          <td><button type="button" onClick={()=>setSelected(row.id)} aria-expanded={selected===row.id} {...buttonProps('secondary','sm')}>View evidence {row.external_entry_id}</button></td>
        </tr>)}</tbody>
      </table></div>
      <div style={{ display:'flex',gap:10,flexWrap:'wrap',marginTop:12 }}>
        <button type="button" disabled={page===1} onClick={()=>setPage(value=>value-1)} {...buttonProps('secondary','sm')}>Previous ledger page</button>
        <button type="button" disabled={page*report.pageSize>=report.totalCount||page>=100000} onClick={()=>setPage(value=>value+1)} {...buttonProps('secondary','sm')}>Next ledger page</button>
        {report.entries.length===0&&page>1?<button type="button" onClick={()=>setPage(1)} {...buttonProps('secondary','sm')}>Return to first ledger page</button>:null}
      </div>
    </>:null}
    {detail?<div role="region" aria-label="Ledger source evidence" style={{ marginTop:16,overflowWrap:'anywhere' }}>
      <h3 style={{ fontSize:14 }}>{detail.source_system_id} · {detail.external_entry_id}</h3>
      <dl>{[['Saved ID',detail.id],['Evidence hash',detail.source_payload_hash],['Lineage',detail.source_lineage_id],['Journal',detail.external_journal_id],['Cost centre',detail.external_cost_centre_code],['External period',detail.accounting_period_key],['Description',detail.description]].map(([label,value])=><div key={label} style={{ marginBottom:8 }}><dt style={{ fontSize:12,color:'var(--text-muted)' }}>{label}</dt><dd style={{ margin:0 }}>{value??'Not supplied'}</dd></div>)}</dl>
      <button type="button" onClick={()=>setSelected('')} {...buttonProps('secondary','sm')}>Close ledger evidence</button>
    </div>:null}
  </section>;
}
