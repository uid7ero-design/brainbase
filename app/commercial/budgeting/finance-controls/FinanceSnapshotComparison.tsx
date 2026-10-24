'use client';
import { useEffect,useRef,useState } from 'react';
import { buttonProps,tableStyles } from '@/components/ui/app';
import { requestFinanceEvidenceDownload } from '@/lib/commercial/financeEvidenceDownload';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { parseReconciliationEvidence,RECONCILIATION_AMOUNT_FIELDS,type ReconciliationEvidenceHeader,type ReconciliationEvidenceScope } from '@/lib/commercial/financeReconciliationEvidenceModel';
import { compareFinanceSnapshotTotals,formatSnapshotHeaderValue,type FinanceSnapshotComparison as Comparison,type ObservedReconciliationHeader } from '@/lib/commercial/financeSnapshotComparison';
import { buildSnapshotComparisonDownload,type SnapshotComparisonDownloadKind } from '@/lib/commercial/financeSnapshotComparisonExport';
const labels=['Source Actual','Finance adjustments','Effective Actual','External GL','Variance'];
export function FinanceSnapshotComparison({scope,baselineId,comparisonId,onClose,onInspect,onSwap}:{scope:ReconciliationEvidenceScope;baselineId:string;comparisonId:string;onClose:()=>void;onInspect:(row:ReconciliationEvidenceHeader,trigger:HTMLButtonElement)=>void;onSwap:(baseline:ObservedReconciliationHeader,comparison:ObservedReconciliationHeader)=>void}){
  const {yearId,periodId,source,currency}=scope;
  const [reload,setReload]=useState(0),[notice,setNotice]=useState(''),[downloadError,setDownloadError]=useState('');
  const [differencesOnly,setDifferencesOnly]=useState(false);
  const key=JSON.stringify([yearId,periodId,source,currency,baselineId,comparisonId,reload]);
  const [result,setResult]=useState<{key:string;comparison:Comparison|null;error:string}>({key:'',comparison:null,error:''});
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start',behavior:'instant'});},[]);
  useEffect(()=>{let current=true;const controller=new AbortController();
    async function read(){try{
      if(baselineId===comparisonId)throw new Error('Choose two different saved snapshots.');
      const expected={yearId,periodId,source,currency};
      async function readOne(id:string):Promise<ObservedReconciliationHeader>{
        const query=new URLSearchParams({...expected,id,filter:'',page:'1'});
        const response=await fetch(`/api/commercial/budgeting/reconciliations/evidence?${query}`,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error('Unable to read both saved snapshots in this scope.');
        const payload=await response.json();const evidence=parseReconciliationEvidence(payload?.evidence,expected,id,'',1);
        return {header:evidence.header,readAt:new Date().toISOString()};
      }
      const [baseline,comparison]=await Promise.all([readOne(baselineId),readOne(comparisonId)]);
      const compared=compareFinanceSnapshotTotals(expected,baseline,comparison);if(current)setResult({key,comparison:compared,error:''});
    }catch(failure){controller.abort();if(current)setResult({key,comparison:null,error:failure instanceof Error?failure.message:'Unable to compare saved snapshot totals.'});}}
    void read();return()=>{current=false;controller.abort();};
  },[yearId,periodId,source,currency,baselineId,comparisonId,key]);
  const loading=result.key!==key,comparison=loading?null:result.comparison;
  const observations=comparison?[{label:'Baseline',observed:comparison.baseline},{label:'Comparison',observed:comparison.comparison}]:[];
  function download(kind:SnapshotComparisonDownloadKind){
    if(!comparison)return;setNotice('');setDownloadError('');
    try{const file=buildSnapshotComparisonDownload(comparison,new Date().toISOString(),kind);setNotice(requestFinanceEvidenceDownload(file));}
    catch{setDownloadError('Unable to download this comparison. Reload both saved snapshots before trying again.');}
  }
  return <section aria-label="Saved snapshot total comparison" style={{border:'1px solid var(--border)',borderRadius:10,padding:16,marginTop:16,minWidth:0,overflowWrap:'anywhere'}}>
    <h3 ref={heading} tabIndex={-1} style={{fontSize:16,marginTop:0,scrollMarginTop:120}}>Compare saved snapshot totals</h3>
    <p style={{fontSize:12}}>Source: {source} · {currency}. Every change is comparison minus baseline, regardless of which snapshot was prepared first. This compares header totals, not individual items, and creates no accounting fact or approval.</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" disabled={loading} onClick={()=>{setNotice('');setDownloadError('');setReload(value=>value+1);}} {...buttonProps('secondary','sm')}>Reload both snapshot totals</button><button type="button" onClick={onClose} {...buttonProps('secondary','sm')}>Close total comparison</button></div>
    {loading?<p role="status">Loading both saved snapshots…</p>:null}{!loading&&result.error?<p role="alert">{result.error} Both reads must complete before comparison or download.</p>:null}
    {comparison?<>
      <p>{comparison.baseline.header.yearName} · {comparison.baseline.header.periodName}</p>
      <button type="button" onClick={()=>onSwap(comparison.comparison,comparison.baseline)} {...buttonProps('secondary','sm')}>Swap baseline and comparison (reload)</button>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>{observations.map(({label,observed:saved})=><div key={label}><h4>{label}</h4><p>{saved.header.id} · {saved.header.status} · {saved.header.latest?'Latest snapshot at read':'Earlier snapshot'}</p><p style={{fontSize:12}}>Snapshot: {formatAustralianTimestamp(saved.header.snapshotAt)} · Prepared: {formatAustralianTimestamp(saved.header.preparedAt)} · Read: {formatAustralianTimestamp(saved.readAt)} · Close: {saved.header.closeId??'Not linked'}.</p><button type="button" onClick={event=>onInspect(saved.header,event.currentTarget)} {...buttonProps('secondary','sm')}>Inspect {label.toLowerCase()} evidence</button></div>)}</div>
      <div role="region" aria-label="Snapshot total changes" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:650}}><thead><tr>{['Measure','Baseline','Comparison','Change (comparison minus baseline)'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{RECONCILIATION_AMOUNT_FIELDS.map((field,index)=><tr key={field}><th scope="row">{labels[index]}</th><td className={tableStyles.num}>{formatMoneyCentsExact(comparison.baseline.header[field],currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(comparison.comparison.header[field],currency)}</td><td className={tableStyles.num}>{formatMoneyCentsExact(comparison.changes[field],currency)}</td></tr>)}</tbody></table></div>
      <p>Unresolved items: baseline {comparison.baseline.header.unresolvedCount} · comparison {comparison.comparison.header.unresolvedCount} · count change {comparison.unresolvedChange}.</p>
      {!comparison.hasAmountChanges?<p>The saved header amounts are unchanged. Lifecycle state, unresolved items or individual comparison rows can still differ.</p>:null}
      <h4>Saved header differences</h4>
      <p style={{fontSize:12}}>{comparison.headerDifferences.filter(row=>row.changed).length} of {comparison.headerDifferences.length} compared header fields differ. These are differences between the two records as read; they do not establish which lifecycle events occurred.</p>
      <label style={{display:'flex',gap:8,alignItems:'center',marginBlock:12}}><input type="checkbox" checked={differencesOnly} onChange={event=>setDifferencesOnly(event.target.checked)}/>Show differing header fields only</label>
      <div role="region" aria-label="Saved header field comparison" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:650}}><thead><tr>{['Header field','Baseline','Comparison','Difference'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{comparison.headerDifferences.filter(row=>!differencesOnly||row.changed).map(row=><tr key={row.field}><th scope="row">{row.label}</th><td style={{whiteSpace:'pre-wrap'}}>{formatSnapshotHeaderValue(row.field,row.baseline)}</td><td style={{whiteSpace:'pre-wrap'}}>{formatSnapshotHeaderValue(row.field,row.comparison)}</td><td>{row.changed?'Different':'Same'}</td></tr>)}{differencesOnly&&!comparison.headerDifferences.some(row=>row.changed)?<tr><td colSpan={4}>No differences in the compared header fields.</td></tr>:null}</tbody></table></div>
      <p style={{fontSize:12,color:'var(--text-muted)'}}>These two headers were read independently. Read times are browser observations, not a shared database snapshot. Stale or historical status stays attached to each version. A zero change does not establish current readiness or sign-off.</p>
      <details style={{marginBlock:12}}><summary>Download comparison evidence</summary><p style={{fontSize:12}}>Downloads include both saved headers and read times. The report includes every compared header field, regardless of the display filter. Open the HTML report locally to print or save as PDF.</p><div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" onClick={()=>download('csv')} {...buttonProps('secondary','sm')}>Export total changes CSV</button><button type="button" onClick={()=>download('header-csv')} {...buttonProps('secondary','sm')}>Export header differences CSV</button><button type="button" onClick={()=>download('json')} {...buttonProps('secondary','sm')}>Download comparison JSON</button><button type="button" onClick={()=>download('report')} {...buttonProps('secondary','sm')}>Download printable HTML report</button></div></details>
    </>:null}
    {!loading&&notice?<p role="status">{notice}</p>:null}{!loading&&downloadError?<p role="alert">{downloadError}</p>:null}
  </section>;
}
