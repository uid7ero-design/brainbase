'use client';
import { useEffect,useRef,useState } from 'react';
import { buttonProps,tableStyles } from '@/components/ui/app';
import { requestFinanceEvidenceDownload } from '@/lib/commercial/financeEvidenceDownload';
import { formatAustralianDate,formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { closeControlSummary,parseCloseEvidence,type CloseEvidence,type CloseEvidenceScope } from '@/lib/commercial/financeCloseEvidenceModel';
import { buildCloseEvidenceDownload,type CloseEvidenceDownloadKind } from '@/lib/commercial/financeCloseEvidenceExport';
import { reconciliationEvidenceTarget,type FinanceEvidenceTarget } from '@/lib/commercial/financeEvidenceNavigation';
export function FinanceCloseEvidence({id,scope,onClose,backLabel='Return to close history',onInspectReconciliation}:{id:string;scope:CloseEvidenceScope;onClose:()=>void;backLabel?:string;onInspectReconciliation?:(target:FinanceEvidenceTarget)=>void}){
  const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[downloadError,setDownloadError]=useState('');
  const key=JSON.stringify([id,scope,revision]);
  const [result,setResult]=useState<{key:string;evidence:CloseEvidence|null;readAt:string;error:string}>({key:'',evidence:null,readAt:'',error:''});
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start',behavior:'instant'});},[]);
  useEffect(()=>{let current=true;const controller=new AbortController();
    async function read(){try{
      const query=new URLSearchParams({id,kind:scope.kind,yearId:scope.yearId});if(scope.periodId)query.set('periodId',scope.periodId);
      const response=await fetch(`/api/commercial/budgeting/close-evidence?${query}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error(response.status===404?'This close record is unavailable in the selected calendar scope.':'Unable to load saved close evidence.');
      const payload=await response.json();const evidence=parseCloseEvidence(payload?.evidence,scope,id);if(current)setResult({key,evidence,readAt:new Date().toISOString(),error:''});
    }catch(failure){if(current)setResult({key,evidence:null,readAt:'',error:failure instanceof Error?failure.message:'Unable to load saved close evidence.'});}}
    void read();return()=>{current=false;controller.abort();};
  },[id,scope,key]);
  const loading=result.key!==key,evidence=loading?null:result.evidence,summary=evidence?closeControlSummary(evidence):null;
  function download(kind:CloseEvidenceDownloadKind){
    if(!evidence)return;setNotice('');setDownloadError('');
    try{const file=buildCloseEvidenceDownload(evidence,scope,result.readAt,new Date().toISOString(),kind);setNotice(requestFinanceEvidenceDownload(file));}
    catch{setDownloadError('Unable to download the saved close record. Reload before trying again.');}
  }
  return <section aria-label="Saved close evidence" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0,overflowWrap:'anywhere'}}>
    <h2 ref={heading} tabIndex={-1} style={{fontSize:16,marginTop:0,scrollMarginTop:120}}>Saved {scope.kind} close evidence</h2>
    <p style={{fontSize:12}}>Inspect one durable close record. This read does not close, reopen or sign off anything.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBlock:12}}><button type="button" disabled={loading} onClick={()=>{setNotice('');setDownloadError('');setRevision(value=>value+1);}} {...buttonProps('secondary','sm')}>Reload close evidence</button><button type="button" onClick={onClose} {...buttonProps('secondary','sm')}>{backLabel}</button></div>
    {loading?<p role="status">Loading saved close evidence…</p>:null}{!loading&&result.error?<p role="alert">{result.error} Reload uses read-only requests.</p>:null}
    {evidence?<>
      <h3 style={{fontSize:14}}>{evidence.yearName}{evidence.periodName?` · ${evidence.periodName}`:''} · sequence {evidence.sequence} · {evidence.status}</h3>
      <p>{evidence.current?'Current close at the time of this read.':'Historical or noncurrent close record.'} {evidence.laterCloseExists?'A later close sequence exists.':''}</p>
      <p style={{fontSize:12}}>Calendar status at read: {evidence.calendarStatus} · Dates at read: {formatAustralianDate(evidence.startsOn)} to {formatAustralianDate(evidence.endsOn)} · Close ID: {evidence.id}.</p>
      <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>{[
        ['Closed by',evidence.closedBy],['Closed at',formatAustralianTimestamp(evidence.closedAt)],['Close reason',evidence.closeReason??'Not supplied'],
        ['Invalidated by',evidence.invalidatedBy??'Not invalidated'],['Invalidated at',evidence.invalidatedAt?formatAustralianTimestamp(evidence.invalidatedAt):'Not invalidated'],['Invalidation reason',evidence.invalidationReason??'Not invalidated'],
      ].map(([label,value])=><div key={label}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{label}</dt><dd style={{margin:0,whiteSpace:'pre-wrap'}}>{value}</dd></div>)}</dl>
      <h3 style={{fontSize:14}}>Control totals captured at close</h3>
      {summary?.kind==='source'?<><p style={{fontSize:12}}>Saved Source Actual, separated by currency. This is not supplier settlement or current finance-adjusted reporting.</p><div role="region" aria-label="Captured close currency totals" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:650}}><thead><tr>{['Currency','Source lines','Exclusive','Tax','Inclusive'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{summary.rows.length?summary.rows.map(row=><tr key={row.currency}><td>{row.currency}</td><td>{row.lineCount}</td><td className={tableStyles.num}>{formatMoneyCentsExact(row.subtotalCents,row.currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(row.taxCents,row.currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(row.totalCents,row.currency)}</td></tr>):<tr><td colSpan={5}>No source currency rows were captured.</td></tr>}</tbody></table></div></>
        :summary?.kind==='year'?<p>At close: {summary.periodCount} financial periods and {summary.closeCount} current period closes. These are saved counts, not current year-close readiness.</p>:<p>No recognised summary is available. Review the complete saved totals below.</p>}
      {evidence.reconciliationStatus?<p style={{fontSize:12}}>Reconciliation status on the close record at read: {evidence.reconciliationStatus}. This field can change with reconciliation lifecycle actions; compare the currently linked records below.</p>:null}
      <details><summary>Complete saved control totals and original timestamps</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(evidence.controlTotals,null,2)}</pre><p>Closed: {evidence.closedAt} · Invalidated: {evidence.invalidatedAt??'Not invalidated'}.</p></details>
      <h3 style={{fontSize:14}}>Reconciliation links observed at read</h3>{scope.kind==='year'?<p>Child-period reconciliation links are not assessed by this year-close inspection.</p>:evidence.linkedReconciliations.length?<ul>{evidence.linkedReconciliations.map(row=>{const target=evidence.periodId?reconciliationEvidenceTarget(evidence.yearId,evidence.periodId,row.id,row.source,row.currency):null;return <li key={row.id} style={{marginBlock:8}}>{row.source} · {row.currency} · {row.status} · {row.id}{target&&onInspectReconciliation?<div><button type="button" onClick={()=>onInspectReconciliation(target)} {...buttonProps('secondary','sm')}>Inspect linked reconciliation</button></div>:null}</li>;})}</ul>:<p>No reconciliation currently links to this close ID. This does not establish that no historical sign-off occurred.</p>}
      <details style={{marginBlock:12}}><summary>Download saved close evidence</summary>
        <p style={{fontSize:12}}>Record details include saved values and calendar observations. Captured totals keep currencies separate. Link exports describe this read; year-close child links are marked as not assessed.</p>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBlock:12}}><button type="button" onClick={()=>download('report')} {...buttonProps('secondary','sm')}>Download readable close report</button><button type="button" onClick={()=>download('record-csv')} {...buttonProps('secondary','sm')}>Export close record details CSV</button><button type="button" onClick={()=>download('totals-csv')} {...buttonProps('secondary','sm')}>Export captured control totals CSV</button><button type="button" onClick={()=>download('links-csv')} {...buttonProps('secondary','sm')}>Export reconciliation links CSV</button><button type="button" onClick={()=>download('json')} {...buttonProps('secondary','sm')}>Download complete close record JSON</button></div>
        <p style={{fontSize:12,color:'var(--text-muted)'}}>CSV retains exact cents and two-decimal amounts as text. Empty or unrecognised totals retain an explicit state and the saved raw totals; they are not inferred as zero. Open the HTML report locally to print or save as PDF. Downloads use the accepted evidence read and create no approval or restore action.</p>
      </details>
      <p style={{fontSize:12,color:'var(--text-muted)'}}>Read completed: {formatAustralianTimestamp(result.readAt)}. Calendar labels/status and links describe this read; control totals describe the close.</p>
    </>:null}
    {!loading&&notice?<p role="status">{notice}</p>:null}{!loading&&downloadError?<p role="alert">{downloadError}</p>:null}
  </section>;
}
