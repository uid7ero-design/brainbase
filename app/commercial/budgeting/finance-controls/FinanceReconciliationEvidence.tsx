'use client';
import { useEffect,useRef,useState } from 'react';
import { Field,buttonProps,fieldControlClassName,tableStyles } from '@/components/ui/app';
import { requestFinanceEvidenceDownload } from '@/lib/commercial/financeEvidenceDownload';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { buildReconciliationEvidenceDownload,type ReconciliationEvidenceDownloadKind } from '@/lib/commercial/financeReconciliationEvidenceExport';
import { periodCloseEvidenceTarget,type FinanceEvidenceTarget } from '@/lib/commercial/financeEvidenceNavigation';
import { RECONCILIATION_OUTCOME_GUIDANCE,reconciliationDimensionLabel,reconciliationSavedText,reconciliationLifecycleLabel } from '@/lib/commercial/financeReconciliationEvidenceDisplay';
import { parseReconciliationEvidence,RECONCILIATION_OUTCOMES,RECONCILIATION_AMOUNT_FIELDS,type ReconciliationEvidence,type ReconciliationEvidenceScope,type ReconciliationEvidenceFilter } from '@/lib/commercial/financeReconciliationEvidenceModel';

const amountLabels=['Source Actual','Finance adjustments','Effective Actual','External GL','Variance'];
export function FinanceReconciliationEvidence({id,scope,onClose,backLabel='Close reconciliation evidence',onInspectClose}:{id:string;scope:ReconciliationEvidenceScope;onClose:()=>void;backLabel?:string;onInspectClose?:(target:FinanceEvidenceTarget)=>void}) {
  const [filter,setFilter]=useState<ReconciliationEvidenceFilter>(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [downloadError,setDownloadError]=useState(''),[notice,setNotice]=useState('');
  const [view,setView]=useState<'cards'|'table'>('cards');
  const key=JSON.stringify([id,scope,filter,page,revision]);
  const [result,setResult]=useState<{key:string;evidence:ReconciliationEvidence|null;readAt:string;error:string}>({key:'',evidence:null,readAt:'',error:''});
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start',behavior:'instant'});},[]);
  useEffect(()=>{let current=true;const controller=new AbortController();
    async function read(){try{
      const query=new URLSearchParams({...scope,id,filter,page:String(page)});
      const response=await fetch(`/api/commercial/budgeting/reconciliations/evidence?${query}`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(response.status===404?'This saved reconciliation is unavailable in the selected scope.':'Unable to load saved reconciliation evidence.');
      const payload=await response.json();const evidence=parseReconciliationEvidence(payload?.evidence,scope,id,filter,page);
      if(current)setResult({key,evidence,readAt:new Date().toISOString(),error:''});
    }catch(failure){if(current)setResult({key,evidence:null,readAt:'',error:failure instanceof Error?failure.message:'Unable to load saved reconciliation evidence.'});}}
    void read();return()=>{current=false;controller.abort();};
  },[id,scope,filter,page,key]);
  const loading=result.key!==key,evidence=loading?null:result.evidence;
  const linkedClose=evidence?periodCloseEvidenceTarget(evidence.header.yearId,evidence.header.periodId,evidence.header.closeId):null;
  function invalidateNotices(){setDownloadError('');setNotice('');}
  function download(kind:ReconciliationEvidenceDownloadKind){
    if(!evidence||loading)return;invalidateNotices();
    try{const file=buildReconciliationEvidenceDownload(evidence,result.readAt,new Date().toISOString(),kind);setNotice(requestFinanceEvidenceDownload(file));
    }catch{setDownloadError('Unable to download this saved evidence. Reload it before trying again.');}
  }
  return <section aria-label="Saved reconciliation evidence" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0,overflowWrap:'anywhere'}}>
    <h2 ref={heading} tabIndex={-1} style={{fontSize:16,marginTop:0,scrollMarginTop:120}}>Saved reconciliation evidence</h2>
    <p style={{fontSize:12}}>This is a separate read of one saved snapshot. It does not review, prepare or sign off a reconciliation. Refresh the control scope if the saved status has changed.</p>
    <p style={{fontSize:12}}>Source: {scope.source} · Currency: {scope.currency} · Reconciliation ID: {id}</p>
    <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}>
      <button type="button" disabled={loading} onClick={()=>{invalidateNotices();setRevision(value=>value+1);}} {...buttonProps('secondary','sm')}>Reload reconciliation evidence</button>
      <button type="button" onClick={onClose} {...buttonProps('secondary','sm')}>{backLabel}</button>
    </div>
    <Field label="Comparison outcome">{control=><select {...control} className={fieldControlClassName} disabled={loading} value={filter} onChange={event=>{invalidateNotices();setFilter(event.target.value as ReconciliationEvidenceFilter);setPage(1);}}><option value="">All outcomes</option><option value="UNRESOLVED">All unresolved outcomes</option>{RECONCILIATION_OUTCOMES.map(value=><option key={value} value={value}>{RECONCILIATION_OUTCOME_GUIDANCE[value].label}</option>)}</select>}</Field>
    <details style={{marginBlock:12}}><summary>What the saved outcomes mean</summary><p style={{fontSize:12}}>These explanations describe saved classifications, not current mapping state or approval. Changes to mappings or source data do not rewrite this saved snapshot.</p>{RECONCILIATION_OUTCOMES.map(outcome=><div key={outcome} style={{marginBlock:12}}><strong>{RECONCILIATION_OUTCOME_GUIDANCE[outcome].label}</strong><p style={{fontSize:12}}>{RECONCILIATION_OUTCOME_GUIDANCE[outcome].meaning} {RECONCILIATION_OUTCOME_GUIDANCE[outcome].review}</p><p style={{fontSize:12}}>Saved code: {outcome}</p></div>)}</details>
    {loading?<p role="status">Loading saved reconciliation evidence…</p>:null}
    {!loading&&result.error?<p role="alert">{result.error} Reload uses read-only requests.</p>:null}
    {evidence?<>
      <h3 style={{fontSize:14}}>{evidence.header.yearName} · {evidence.header.periodName} · {evidence.header.status}</h3>
      {!evidence.header.latest?<p>A newer snapshot exists for this scope. This evidence remains historical; refresh the controls to inspect the latest snapshot.</p>:null}
      {evidence.header.status==='STALE'?<p>This snapshot is stale. Its recorded amounts remain evidence of the earlier comparison.</p>:null}
      <p style={{fontSize:12}}>Snapshot: {formatAustralianTimestamp(evidence.header.snapshotAt)} · Read completed: {formatAustralianTimestamp(result.readAt)} · Close: {evidence.header.closeId??'Not linked'} · Unresolved items: {evidence.unresolvedCount} of {evidence.totalCount}.</p>
      {linkedClose&&onInspectClose?<p><button type="button" onClick={()=>onInspectClose(linkedClose)} {...buttonProps('secondary','sm')}>Inspect linked period close</button></p>:null}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>{RECONCILIATION_AMOUNT_FIELDS.map((field,index)=><div key={field} style={{border:'1px solid var(--border)',borderRadius:8,padding:10}}><div style={{fontSize:12,color:'var(--text-muted)'}}>{amountLabels[index]} · all saved items</div><strong>{formatMoneyCentsExact(evidence.header[field],scope.currency)}</strong></div>)}</div>
      <p style={{fontSize:12}}>Page {page} · {evidence.filteredCount} matching items. Totals above cover all saved items, including outcomes outside the selected filter. Current account and cost-centre labels accompany the saved identities below.</p>
      <details style={{marginBlock:12}}><summary>Download saved reconciliation evidence</summary>
        <p style={{fontSize:12}}>Choose a file for the evidence you need. Item downloads include this selected page only; summary totals and lifecycle history cover the saved snapshot independently of the item filter. All files use this accepted read without loading other pages.</p>
        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" onClick={()=>download('report')} {...buttonProps('secondary','sm')}>Download printable evidence report</button><button type="button" onClick={()=>download('summary-csv')} {...buttonProps('secondary','sm')}>Export all-item totals summary CSV</button><button type="button" onClick={()=>download('events-csv')} {...buttonProps('secondary','sm')}>Export saved lifecycle history CSV</button><button type="button" disabled={!evidence.items.length} onClick={()=>download('csv')} {...buttonProps('secondary','sm')}>Export displayed comparison page CSV</button><button type="button" onClick={()=>download('json')} {...buttonProps('secondary','sm')}>Download evidence page JSON</button></div>
        <p style={{fontSize:12,color:'var(--text-muted)'}}>The HTML report and JSON retain the header, all-item totals, lifecycle events and selected item page. Open the HTML report locally to print or save as PDF. CSV preserves exact cents and two-decimal amounts as text. These files are read-only evidence, not sign-off or restore files.</p>
      </details>
      <p style={{fontSize:12}}>Missing identities or codes mean they were not recorded for that saved row. Account-level or aggregated comparisons may not have one cost centre or mapping identity; use the saved outcome and evidence to understand the row.</p>
      <div role="group" aria-label="Saved item display" style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" aria-pressed={view==='cards'} onClick={()=>setView('cards')} {...buttonProps('secondary','sm')}>Item cards</button><button type="button" aria-pressed={view==='table'} onClick={()=>setView('table')} {...buttonProps('secondary','sm')}>Detailed table</button></div>
      {view==='cards'?<div aria-label="Saved comparison item cards">{evidence.items.length?evidence.items.map(item=>{const guidance=RECONCILIATION_OUTCOME_GUIDANCE[item.outcome];return <article key={item.id} aria-label={`Saved comparison item ${item.id}`} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,marginBlock:12,minWidth:0}}>
        <h3 style={{fontSize:14,marginTop:0}}>{guidance.label}</h3><p style={{fontSize:12}}>{guidance.meaning}</p><p style={{fontSize:12}}>Account: {reconciliationDimensionLabel(item.accountId,item.accountCode)} · Cost centre: {reconciliationDimensionLabel(item.centreId,item.centreCode)}</p>
        <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>{RECONCILIATION_AMOUNT_FIELDS.map((field,index)=><div key={field}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{amountLabels[index]}</dt><dd style={{margin:0}}>{formatMoneyCentsExact(item[field],scope.currency)}</dd></div>)}</dl>
        <p style={{fontSize:12}}>Source count: {item.sourceCount} · External entry count: {item.externalCount}.</p><p style={{fontSize:12}}>{guidance.review}</p>
        <details><summary>Saved codes and identities</summary><dl>{[
          ['Outcome code',item.outcome],['Item ID',item.id],['Account ID',item.accountId],['Cost centre ID',item.centreId],['Account mapping ID',item.accountMappingId],['Cost-centre mapping ID',item.centreMappingId],['External account code',item.externalAccountCode],['External cost-centre code',item.externalCentreCode],
        ].map(([label,value])=><div key={label}><dt style={{fontSize:12,color:'var(--text-muted)'}}>{label}</dt><dd style={{margin:'0 0 8px',whiteSpace:'pre-wrap'}}>{reconciliationSavedText(value)}</dd></div>)}</dl></details>
      </article>;}):<p>No saved comparison items on this page for the selected outcome.</p>}</div>:<div role="region" aria-label="Saved comparison items" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:1600}}><thead><tr>{['Outcome','Account','Cost centre','External account','External cost centre',...amountLabels,'Source count','External count','Saved identities'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{evidence.items.length?evidence.items.map(item=><tr key={item.id}>
        <td>{RECONCILIATION_OUTCOME_GUIDANCE[item.outcome].label}<div style={{fontSize:12}}>{item.outcome}</div></td><td>{reconciliationDimensionLabel(item.accountId,item.accountCode)}</td><td>{reconciliationDimensionLabel(item.centreId,item.centreCode)}</td><td>{reconciliationSavedText(item.externalAccountCode)}</td><td>{reconciliationSavedText(item.externalCentreCode)}</td>
        {RECONCILIATION_AMOUNT_FIELDS.map(field=><td key={field} className={tableStyles.num}>{formatMoneyCentsExact(item[field],scope.currency)}</td>)}<td>{item.sourceCount}</td><td>{item.externalCount}</td>
        <td><div>Item: {item.id}</div><div>Account: {reconciliationSavedText(item.accountId)}</div><div>Cost centre: {reconciliationSavedText(item.centreId)}</div><div>Account mapping: {reconciliationSavedText(item.accountMappingId)}</div><div>Cost-centre mapping: {reconciliationSavedText(item.centreMappingId)}</div></td>
      </tr>):<tr><td colSpan={13}>No saved comparison items on this page for the selected outcome.</td></tr>}</tbody></table></div>}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" disabled={page===1} onClick={()=>{invalidateNotices();setPage(value=>value-1);}} {...buttonProps('secondary','sm')}>Previous comparison page</button><button type="button" disabled={page*25>=evidence.filteredCount||page>=100000} onClick={()=>{invalidateNotices();setPage(value=>value+1);}} {...buttonProps('secondary','sm')}>Next comparison page</button>{page>1&&!evidence.items.length?<button type="button" onClick={()=>{invalidateNotices();setPage(1);}} {...buttonProps('secondary','sm')}>First comparison page</button>:null}</div>
      <details><summary>Saved preparation and review details</summary><p>Prepared by {evidence.header.preparedBy} at {formatAustralianTimestamp(evidence.header.preparedAt)}.</p><p>Reviewed by {evidence.header.reviewedBy??'Not recorded'} · {evidence.header.reviewedAt?formatAustralianTimestamp(evidence.header.reviewedAt):'Not recorded'}.</p><p style={{whiteSpace:'pre-wrap'}}>Notes: {evidence.header.notes??'Not supplied'}</p></details>
      <h3 style={{fontSize:14}}>Lifecycle history</h3><p style={{fontSize:12}}>Recorded events for this snapshot, independent of the selected item page and outcome filter. A past sign-off event does not establish current approval.</p><ol style={{paddingLeft:20}}>{evidence.events.map(event=>{const eventClose=typeof event.details.closeId==='string'?periodCloseEvidenceTarget(evidence.header.yearId,evidence.header.periodId,event.details.closeId):null;return <li key={event.id} style={{marginBlock:14}}><strong>{reconciliationLifecycleLabel(event.type)}</strong><p style={{fontSize:12,marginBlock:4}}>{formatAustralianTimestamp(event.at)} · Actor: {event.actor}</p><details><summary>Saved event details</summary><p>Type: {event.type} · Event: {event.id}</p><p>Original timestamp: {event.at}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(event.details,null,2)}</pre></details>{eventClose&&onInspectClose?<p><button type="button" onClick={()=>onInspectClose(eventClose)} {...buttonProps('secondary','sm')}>Inspect close referenced by this event</button></p>:null}</li>;})}</ol>
    </>:null}
    {!loading&&notice?<p role="status">{notice}</p>:null}{!loading&&downloadError?<p role="alert">{downloadError}</p>:null}
  </section>;
}
