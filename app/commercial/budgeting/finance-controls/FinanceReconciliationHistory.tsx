'use client';
import { useEffect,useRef,useState } from 'react';
import { Field,buttonProps,fieldControlClassName,tableStyles } from '@/components/ui/app';
import { requestFinanceEvidenceDownload } from '@/lib/commercial/financeEvidenceDownload';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { RECONCILIATION_AMOUNT_FIELDS,type ReconciliationEvidenceHeader,type ReconciliationEvidenceScope } from '@/lib/commercial/financeReconciliationEvidenceModel';
import { parseReconciliationHistory,RECONCILIATION_HISTORY_STATUSES,type ReconciliationHistory,type ReconciliationHistoryStatus } from '@/lib/commercial/financeReconciliationHistoryModel';
import { buildReconciliationHistoryDownload,type ReconciliationHistoryDownloadKind } from '@/lib/commercial/financeReconciliationHistoryExport';
import { FinanceSnapshotComparison } from './FinanceSnapshotComparison';
const amountLabels=['Source Actual','Finance adjustments','Effective Actual','External GL','Variance'];
export function FinanceReconciliationHistory({scope,enabled,revision,onInspect}:{scope:ReconciliationEvidenceScope;enabled:boolean;revision:number;onInspect:(row:ReconciliationEvidenceHeader,trigger:HTMLButtonElement)=>void}){
  const {yearId,periodId,source,currency}=scope;
  const [open,setOpen]=useState(false),[status,setStatus]=useState<ReconciliationHistoryStatus>(''),[reload,setReload]=useState(0);
  const [view,setView]=useState<'cards'|'table'>('cards');
  const [paging,setPaging]=useState({key:'',page:1});
  const comparisonScopeKey=JSON.stringify([yearId,periodId,source,currency,revision]);
  const [baseline,setBaseline]=useState<{key:string;id:string;preparedAt:string}|null>(null);
  const [pair,setPair]=useState<{key:string;baselineId:string;comparisonId:string;visit:number}|null>(null);
  const activeBaseline=baseline?.key===comparisonScopeKey?baseline:null;
  const comparisonVisit=useRef(0),comparisonTrigger=useRef<HTMLButtonElement|null>(null);
  const baseKey=JSON.stringify([yearId,periodId,source,currency,status]),page=paging.key===baseKey?paging.page:1;
  const key=JSON.stringify([baseKey,page,revision,reload,enabled,open]);
  const ready=enabled&&open&&!!yearId&&!!periodId&&!!source.trim()&&source===source.trim()&&source.length<=300&&/^[A-Z]{3}$/.test(currency);
  const [result,setResult]=useState<{key:string;history:ReconciliationHistory|null;readAt:string;error:string}>({key:'',history:null,readAt:'',error:''});
  const [downloadState,setDownloadState]=useState({key:'',notice:'',error:''});
  useEffect(()=>{let current=true;const controller=new AbortController();if(!ready){queueMicrotask(()=>{if(current)setResult(previous=>previous.key?{key:'',history:null,readAt:'',error:''}:previous);});return()=>{current=false;controller.abort();};}
    async function read(){try{const expected={yearId,periodId,source,currency},query=new URLSearchParams({...expected,status,page:String(page)});
      const response=await fetch(`/api/commercial/budgeting/reconciliations/history?${query}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Unable to load saved reconciliation history.');
      const payload=await response.json();const history=parseReconciliationHistory(payload?.history,expected,status,page);if(current)setResult({key,history,readAt:new Date().toISOString(),error:''});
    }catch(failure){if(current)setResult({key,history:null,readAt:'',error:failure instanceof Error?failure.message:'Unable to load saved reconciliation history.'});}}
    void read();return()=>{current=false;controller.abort();};
  },[ready,yearId,periodId,source,currency,status,page,key]);
  const loading=ready&&result.key!==key,history=ready&&result.key===key?result.history:null;
  function clearNotices(){setDownloadState({key:'',notice:'',error:''});}
  function closeComparison(){setPair(null);requestAnimationFrame(()=>{const trigger=comparisonTrigger.current;if(trigger?.isConnected&&!trigger.disabled)trigger.focus();else document.getElementById('finance-reconciliation-history')?.focus();});}
  function inspectAction(row:ReconciliationEvidenceHeader){return <button type="button" aria-label={`Inspect reconciliation ${row.id}`} onClick={event=>onInspect(row,event.currentTarget)} {...buttonProps('secondary','sm')}>Inspect saved snapshot</button>;}
  function comparisonActions(row:ReconciliationEvidenceHeader){return <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button type="button" aria-label={`${activeBaseline?.id===row.id?'Clear':'Use'} reconciliation ${row.id} as baseline`} aria-pressed={activeBaseline?.id===row.id} onClick={()=>{setPair(null);setBaseline(activeBaseline?.id===row.id?null:{key:comparisonScopeKey,id:row.id,preparedAt:row.preparedAt});}} {...buttonProps('secondary','sm')}>{activeBaseline?.id===row.id?'Clear this baseline':'Use as baseline'}</button><button type="button" aria-label={`Compare reconciliation ${row.id} to selected baseline`} disabled={!activeBaseline||activeBaseline.id===row.id} onClick={event=>{if(!activeBaseline||activeBaseline.id===row.id)return;comparisonTrigger.current=event.currentTarget;setPair({key:comparisonScopeKey,baselineId:activeBaseline.id,comparisonId:row.id,visit:++comparisonVisit.current});}} {...buttonProps('secondary','sm')}>Compare to baseline</button></div>;}
  function download(kind:ReconciliationHistoryDownloadKind){
    if(!history)return;clearNotices();
    try{const file=buildReconciliationHistoryDownload(history,result.readAt,new Date().toISOString(),kind);setDownloadState({key,notice:requestFinanceEvidenceDownload(file),error:''});}
    catch{setDownloadState({key,notice:'',error:'Unable to download this history page. Reload before trying again.'});}
  }
  return <section id="finance-reconciliation-history" tabIndex={-1} aria-label="Saved reconciliation history" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0,overflowWrap:'anywhere',scrollMarginTop:120}}>
    <h2 style={{fontSize:16,marginTop:0}}>Saved reconciliation history</h2>
    <p style={{fontSize:12}}>Browse earlier snapshots for one selected year, period, source and currency. Each version is separate; amounts across versions are not added together. Inspecting history does not review, prepare or sign off a snapshot.</p>
    <button type="button" disabled={!enabled} aria-expanded={open} onClick={()=>{clearNotices();setOpen(value=>!value);setReload(value=>value+1);}} {...buttonProps('secondary','sm')}>{open?'Hide saved reconciliation history':'Show saved reconciliation history'}</button>
    {open&&!ready?<p>Choose a year, period, External GL source and three-letter currency, then wait for saved controls to load.</p>:null}
    {ready?<>
      <p style={{fontSize:12}}>Source: {source} · Currency: {currency} · Period ID: {periodId}.</p>
      <Field label="History lifecycle status">{control=><select {...control} className={fieldControlClassName} disabled={loading} value={status} onChange={event=>{clearNotices();setStatus(event.target.value as ReconciliationHistoryStatus);}}><option value="">All lifecycle statuses</option>{RECONCILIATION_HISTORY_STATUSES.map(value=><option key={value} value={value}>{value}</option>)}</select>}</Field>
      <button type="button" disabled={loading} onClick={()=>{clearNotices();setReload(value=>value+1);}} {...buttonProps('secondary','sm')}>Reload reconciliation history</button>
      {loading?<p role="status">Loading saved reconciliation history…</p>:null}{!loading&&result.error?<p role="alert">{result.error} Reload uses read-only requests.</p>:null}
      {history?<>
        <p style={{fontSize:12}}>Page {page} · {history.totalCount} matching snapshots · Loaded {formatAustralianTimestamp(result.readAt)}. Latest means newest saved snapshot in the full scope, independent of this status filter; it does not establish approval.</p>
        {activeBaseline?<p style={{fontSize:12}}>Selected baseline: {activeBaseline.id} · prepared {formatAustralianTimestamp(activeBaseline.preparedAt)}. You can choose a comparison from another page or lifecycle filter in this same scope. Both headers are read afresh when compared. <button type="button" onClick={()=>{setBaseline(null);setPair(null);document.getElementById('finance-reconciliation-history')?.focus();}} {...buttonProps('secondary','sm')}>Clear comparison baseline</button></p>:<p style={{fontSize:12}}>Choose a baseline below, then compare another saved snapshot’s totals against it.</p>}
        <details style={{marginBlock:12}}><summary>Download displayed history page</summary><div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" onClick={()=>download('report')} {...buttonProps('secondary','sm')}>Download printable history report</button><button type="button" disabled={!history.records.length} onClick={()=>download('csv')} {...buttonProps('secondary','sm')}>Export displayed history CSV</button><button type="button" onClick={()=>download('json')} {...buttonProps('secondary','sm')}>Download history page JSON</button></div><p style={{fontSize:12,color:'var(--text-muted)'}}>Downloads include this page’s saved headers only. Inspect a record for its comparison items and lifecycle events. Versions remain separate and must not be summed. Open the HTML report locally to print or save as PDF. CSV keeps exact cents and two-decimal amounts as text.</p></details>
        <div role="group" aria-label="History display" style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" aria-pressed={view==='cards'} onClick={()=>setView('cards')} {...buttonProps('secondary','sm')}>Snapshot cards</button><button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')} {...buttonProps('secondary','sm')}>Detailed table</button></div>
        {view==='cards'?<div aria-label="Reconciliation history cards">{history.records.length?history.records.map(row=><article key={row.id} aria-label={`Saved snapshot ${row.id}`} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,marginBlock:12,minWidth:0}}>
          <h3 style={{fontSize:14,marginTop:0}}>{row.yearName} · {row.periodName} · {row.status} · {row.latest?'Latest snapshot at read':'Earlier snapshot'}</h3>
          <p style={{fontSize:12}}>Prepared {formatAustralianTimestamp(row.preparedAt)} · Snapshot {formatAustralianTimestamp(row.snapshotAt)} · {row.unresolvedCount} unresolved items.</p><p style={{fontSize:12}}>ID: {row.id}</p>
          {row.status==='STALE'?<p style={{fontSize:12}}>Stale snapshot: these saved amounts describe an earlier comparison.</p>:null}
          <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBlock:12}}>{RECONCILIATION_AMOUNT_FIELDS.map((field,index)=><div key={field}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{amountLabels[index]}</dt><dd style={{margin:0}}>{formatMoneyCentsExact(row[field],currency)}</dd></div>)}</dl>
          <details style={{marginBlock:12}}><summary>Saved identities and notes</summary><p>Close: {row.closeId??'Not linked'}</p><p>Prepared by: {row.preparedBy} · Original preparation time: {row.preparedAt}</p><p>Reviewed by: {row.reviewedBy??'Not recorded'} · {row.reviewedAt??'Not recorded'}</p><p style={{whiteSpace:'pre-wrap'}}>Notes: {row.notes===null?'Not supplied':row.notes===''?'Empty saved text':row.notes}</p></details>
          <div style={{display:'grid',gap:8}}>{inspectAction(row)}{comparisonActions(row)}</div>
        </article>):<p>No saved snapshots on this page for the selected lifecycle status.</p>}</div>:<div role="region" aria-label="Reconciliation history table" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:1800}}><thead><tr>{['Prepared','Snapshot','Status','Latest at read',...amountLabels,'Unresolved','Close ID','Saved metadata','Evidence','Compare totals'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{history.records.length?history.records.map(row=><tr key={row.id}>
          <td>{formatAustralianTimestamp(row.preparedAt)}</td><td>{formatAustralianTimestamp(row.snapshotAt)}</td><td>{row.status}</td><td>{row.latest?'Latest snapshot':'Earlier snapshot'}</td>
          {RECONCILIATION_AMOUNT_FIELDS.map(field=><td key={field} className={tableStyles.num}>{formatMoneyCentsExact(row[field],currency)}</td>)}<td>{row.unresolvedCount}</td><td>{row.closeId??'Not linked'}</td>
          <td><details><summary>Saved identities and notes</summary><p>ID: {row.id}</p><p>Prepared by: {row.preparedBy} · Original preparation time: {row.preparedAt}</p><p>Reviewed by: {row.reviewedBy??'Not recorded'} · {row.reviewedAt??'Not recorded'}</p><p style={{whiteSpace:'pre-wrap'}}>Notes: {row.notes===null?'Not supplied':row.notes===''?'Empty saved text':row.notes}</p></details></td>
          <td>{inspectAction(row)}</td><td>{comparisonActions(row)}</td>
        </tr>):<tr><td colSpan={14}>No saved snapshots on this page for the selected lifecycle status.</td></tr>}</tbody></table></div>}
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" disabled={page===1} onClick={()=>{clearNotices();setPaging({key:baseKey,page:page-1});}} {...buttonProps('secondary','sm')}>Previous history page</button><button type="button" disabled={page*25>=history.totalCount||page>=100000} onClick={()=>{clearNotices();setPaging({key:baseKey,page:page+1});}} {...buttonProps('secondary','sm')}>Next history page</button>{page>1&&!history.records.length?<button type="button" onClick={()=>{clearNotices();setPaging({key:baseKey,page:1});}} {...buttonProps('secondary','sm')}>First history page</button>:null}</div>
        {pair?.key===comparisonScopeKey&&activeBaseline?.id===pair.baselineId?<FinanceSnapshotComparison key={JSON.stringify([pair.key,pair.baselineId,pair.comparisonId,pair.visit])} scope={{yearId,periodId,source,currency}} baselineId={pair.baselineId} comparisonId={pair.comparisonId} onClose={closeComparison} onInspect={onInspect} onSwap={(newBaseline,newComparison)=>{setBaseline({key:comparisonScopeKey,id:newBaseline.header.id,preparedAt:newBaseline.header.preparedAt});setPair({key:comparisonScopeKey,baselineId:newBaseline.header.id,comparisonId:newComparison.header.id,visit:++comparisonVisit.current});}}/>:null}
      </>:null}
      {!loading&&downloadState.key===key&&downloadState.notice?<p role="status">{downloadState.notice}</p>:null}{!loading&&downloadState.key===key&&downloadState.error?<p role="alert">{downloadState.error}</p>:null}
    </>:null}
  </section>;
}
