'use client';
import { useEffect,useRef,useState } from 'react';
import { buttonProps,tableStyles,fieldControlClassName,Field } from '@/components/ui/app';
import { formatAustralianTimestamp } from '@/lib/commercial/financeSetupDisplay';
import { formatMoneyCentsExact } from '@/lib/commercial/money';
import { FinanceAdjustmentExports } from './FinanceAdjustmentExports';
import { FinanceAdjustmentLineEvidence } from './FinanceAdjustmentLineEvidence';
import { FinanceAdjustmentLifecycle } from './FinanceAdjustmentLifecycle';
import { ADJUSTMENT_REVIEW_TYPES,parseAdjustmentRegister,parseAdjustmentEvidence,adjustmentLineTotals,type AdjustmentReviewType,type AdjustmentStatus,type AdjustmentRegister,type AdjustmentEvidence } from '@/lib/commercial/financeAdjustmentReviewModel';
const endpoint='/api/commercial/budgeting/finance-adjustments/review';
export function FinanceAdjustmentReview({periodId,currency,enabled,revision}:{periodId:string;currency:string;enabled:boolean;revision:number}){
  const [status,setStatus]=useState<''|AdjustmentStatus>('');
  const [adjustmentType,setAdjustmentType]=useState<''|AdjustmentReviewType>('');
  const [search,setSearch]=useState(''),[draftSearch,setDraftSearch]=useState(''),[searchError,setSearchError]=useState('');
  const filtersDirty=draftSearch.trim()!==search;
  const scope={periodId,currency,status,adjustmentType,search};
  const baseKey=JSON.stringify(scope);
  const [paging,setPaging]=useState({key:'',page:1});
  const page=paging.key===baseKey?paging.page:1;
  const [reload,setReload]=useState(0);
  const [registerView,setRegisterView]=useState<'cards'|'table'>('cards'),[detailVisit,setDetailVisit]=useState(0);
  const key=JSON.stringify([baseKey,page,revision,reload,enabled]);
  const ready=enabled&&!!periodId&&/^[A-Z]{3}$/.test(currency);
  const [result,setResult]=useState<{key:string;report:AdjustmentRegister|null;error:string;readAt:string|null}>({key:'',report:null,error:'',readAt:null});
  const [selection,setSelection]=useState({key:'',id:''});
  const selectedId=selection.key===key?selection.id:'';
  const detailKey=JSON.stringify([key,selectedId,detailVisit]);
  const [detail,setDetail]=useState<{key:string;evidence:AdjustmentEvidence|null;error:string;readAt:string|null}>({key:'',evidence:null,error:'',readAt:null});
  const trigger=useRef<HTMLButtonElement|null>(null);
  const evidenceHeading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{let current=true;if(!ready)return;const controller=new AbortController();
    async function read(){try{const query=new URLSearchParams({periodId,currency,status,adjustmentType,search,page:String(page)});const response=await fetch(`${endpoint}?${query}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Unable to load saved finance adjustments.');const data=await response.json();const report=parseAdjustmentRegister(data?.report,{periodId,currency,status,adjustmentType,search},page);if(current)setResult({key,report,error:'',readAt:new Date().toISOString()});}
      catch(failure){if(current)setResult({key,report:null,error:failure instanceof Error?failure.message:'Unable to load saved finance adjustments.',readAt:null});}}
    void read();return()=>{current=false;controller.abort();};
  },[ready,periodId,currency,status,adjustmentType,search,page,key]);
  useEffect(()=>{let current=true;if(!ready||!selectedId)return;const controller=new AbortController();
    async function read(){try{const query=new URLSearchParams({periodId,currency,status,adjustmentType,search,id:selectedId});const response=await fetch(`${endpoint}?${query}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Unable to load this adjustment in the selected scope.');const data=await response.json();const evidence=parseAdjustmentEvidence(data?.evidence,{periodId,currency,status,adjustmentType,search},selectedId);if(current)setDetail({key:detailKey,evidence,error:'',readAt:new Date().toISOString()});}
      catch(failure){if(current)setDetail({key:detailKey,evidence:null,error:failure instanceof Error?failure.message:'Unable to load saved adjustment evidence.',readAt:null});}}
    void read();return()=>{current=false;controller.abort();};
  },[ready,periodId,currency,status,adjustmentType,search,selectedId,detailKey]);
  const loading=ready&&result.key!==key;
  const report=ready&&result.key===key?result.report:null;
  const error=ready&&result.key===key?result.error:'';
  const evidence=report&&selectedId&&detail.key===detailKey?detail.evidence:null;
  const detailError=report&&selectedId&&detail.key===detailKey?detail.error:'';
  const totals=evidence?adjustmentLineTotals(evidence.lines):[];
  const detailLoading=!!report&&!!selectedId&&detail.key!==detailKey;
  useEffect(()=>{if(evidence){evidenceHeading.current?.focus({preventScroll:true});evidenceHeading.current?.scrollIntoView({block:'start',behavior:'instant'});}},[evidence]);
  function closeEvidence(){setSelection({key:'',id:''});requestAnimationFrame(()=>{if(trigger.current?.isConnected&&!trigger.current.disabled)trigger.current.focus();else document.getElementById('finance-adjustment-review')?.focus();});}
  function reviewButton(row:AdjustmentRegister['adjustments'][number]){return <button type="button" aria-expanded={selectedId===row.id} onClick={event=>{trigger.current=event.currentTarget;setSelection({key,id:row.id});setDetailVisit(value=>value+1);}} {...buttonProps('secondary','sm')}>Review adjustment {row.number}</button>;}
  return <section id="finance-adjustment-review" tabIndex={-1} aria-label="Finance adjustment review" style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:'var(--radius-lg)',padding:18,marginBottom:18,minWidth:0,scrollMarginTop:120}}>
    <h2 style={{fontSize:16,marginTop:0}}>Finance adjustments</h2>
    <p style={{fontSize:12,color:'var(--text-muted)'}}>Review saved adjustment lines and lifecycle evidence for the selected period and currency. The External GL source selector does not filter adjustments. Draft, posted and reversed records remain separate; this review does not create, post or reverse an adjustment.</p>
    {!ready?<p>Choose a financial period and a three-letter currency, then wait for the finance controls to finish loading.</p>:<>
      <Field label="Adjustment status">{control=><select {...control} className={fieldControlClassName} value={status} disabled={loading} onChange={event=>setStatus(event.target.value as ''|AdjustmentStatus)}><option value="">All statuses</option>{(['DRAFT','POSTED','REVERSED']as const).map(value=><option key={value} value={value}>{value}</option>)}</select>}</Field>
      <Field label="Adjustment type">{control=><select {...control} className={fieldControlClassName} value={adjustmentType} disabled={loading} onChange={event=>setAdjustmentType(event.target.value as ''|AdjustmentReviewType)}><option value="">All adjustment types</option>{ADJUSTMENT_REVIEW_TYPES.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select>}</Field>
      <form aria-label="Search saved finance adjustments" onSubmit={event=>{event.preventDefault();const next=draftSearch.trim();if(next.length>200||/[\u0000-\u001f\u007f]/.test(next)){setSearchError('Use up to 200 search characters without control characters.');return;}setSearchError('');setSearch(next);setDraftSearch(next);setPaging({key:JSON.stringify({periodId,currency,status,adjustmentType,search:next}),page:1});setReload(value=>value+1);}} style={{marginBlock:12}}>
        <Field label="Search adjustments">{control=><input {...control} className={fieldControlClassName} type="search" value={draftSearch} maxLength={200} disabled={loading} onChange={event=>{setDraftSearch(event.target.value);setSearchError('');}} />}</Field>
        <p style={{fontSize:12,color:'var(--text-muted)'}}>Search number, saved ID, description, reason or source reference across all matching pages. Text is matched literally, ignoring letter case.</p>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button type="submit" disabled={loading} {...buttonProps('secondary','sm')}>Apply adjustment search</button><button type="button" disabled={loading} onClick={()=>{setSearch('');setDraftSearch('');setSearchError('');setPaging({key:JSON.stringify({periodId,currency,status,adjustmentType,search:''}),page:1});setReload(value=>value+1);}} {...buttonProps('secondary','sm')}>Clear adjustment search</button></div>
      </form>
      {searchError?<p role="alert">{searchError}</p>:null}
      {filtersDirty?<p>Search changes are not applied. The records below use the last applied search; apply or clear your changes to enable downloads.</p>:null}
      <button type="button" disabled={loading} onClick={()=>setReload(value=>value+1)} {...buttonProps('secondary','sm')}>Reload adjustment register</button>
      {loading?<p role="status">Loading saved adjustment register…</p>:null}
      {error?<p role="alert">{error} Reload the register before relying on this view.</p>:null}
      {report?<>
        <p style={{fontSize:12}}>Page {page} · {report.totalCount} matching adjustments · {currency} · {adjustmentType?adjustmentType.replaceAll('_',' '):'All adjustment types'} · Applied search: {search||'None'}. Monetary amounts are shown in each saved adjustment; statuses are not combined into a new approval.</p>
        {result.readAt&&!filtersDirty ? <FinanceAdjustmentExports key={detailKey} input={{scope,report,evidence,registerReadAt:result.readAt,evidenceReadAt:evidence?detail.readAt:null}} /> : null}
        <div role="group" aria-label="Adjustment register display" style={{display:'flex',flexWrap:'wrap',gap:8,marginBlock:12}}><button type="button" aria-pressed={registerView==='cards'} onClick={()=>setRegisterView('cards')} {...buttonProps('secondary','sm')}>Adjustment cards</button><button type="button" aria-pressed={registerView==='table'} onClick={()=>setRegisterView('table')} {...buttonProps('secondary','sm')}>Detailed table</button></div>
        {registerView==='cards'?<div aria-label="Saved adjustment cards">{report.adjustments.length?report.adjustments.map(row=><article key={row.id} style={{border:'1px solid var(--border)',borderRadius:8,padding:14,marginBlock:12,minWidth:0,overflowWrap:'anywhere'}}>
          <h3 style={{fontSize:14,marginTop:0}}>Adjustment {row.number} · {row.status}</h3><p style={{fontSize:12}}>{row.type.replaceAll('_',' ')} · {formatAustralianTimestamp(row.createdAt)}</p><p style={{whiteSpace:'pre-wrap'}}>{row.description}</p><p style={{fontSize:12,whiteSpace:'pre-wrap'}}>Reason: {row.reason}</p>
          <details style={{marginBlock:10}}><summary>Saved identity and references</summary><p style={{fontSize:12}}>ID: {row.id} · Period: {row.periodName} · {row.currency}</p><p style={{fontSize:12}}>Source: {row.sourceType??'Not recorded'} · {row.sourceId??'Not recorded'} · Reversal of: {row.reversalOf??'Not applicable'} · Reference period: {row.referencePeriodId??'Not supplied'}.</p></details>{reviewButton(row)}
        </article>):<p>No finance adjustments match this scope.</p>}</div>:<div role="region" aria-label="Adjustment register table" tabIndex={0} style={{overflowX:'auto'}}><table className={tableStyles.table} style={{minWidth:900}}><thead><tr>{['Adjustment','Status','Type','Description','Reason','Created','Evidence'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
          {report.adjustments.length===0?<tr><td colSpan={7}>No finance adjustments match this scope.</td></tr>:report.adjustments.map(row=><tr key={row.id}><td>{row.number}</td><td>{row.status}</td><td>{row.type.replaceAll('_',' ')}</td><td>{row.description}</td><td>{row.reason}</td><td>{formatAustralianTimestamp(row.createdAt)}</td><td>{reviewButton(row)}</td></tr>)}
        </tbody></table></div>}
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:12}}><button type="button" disabled={page===1} onClick={()=>setPaging({key:baseKey,page:page-1})} {...buttonProps('secondary','sm')}>Previous adjustment page</button><button type="button" disabled={page*25>=report.totalCount||page>=100000} onClick={()=>setPaging({key:baseKey,page:page+1})} {...buttonProps('secondary','sm')}>Next adjustment page</button>{page>1&&!report.adjustments.length?<button type="button" onClick={()=>setPaging({key:baseKey,page:1})} {...buttonProps('secondary','sm')}>First adjustment page</button>:null}</div>
      </>:null}
      {report&&selectedId?<div role="group" aria-label="Selected adjustment evidence controls" style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}><button type="button" disabled={detailLoading} onClick={()=>setDetailVisit(value=>value+1)} {...buttonProps('secondary','sm')}>Reload selected adjustment evidence</button><button type="button" onClick={closeEvidence} {...buttonProps('secondary','sm')}>Close adjustment evidence</button></div>:null}
      {detailLoading?<p role="status">Loading saved adjustment evidence…</p>:null}
      {detailError?<p role="alert">{detailError} Retry the selected evidence or reload the register if the record’s scope or status changed.</p>:null}
      {evidence?<div role="region" aria-label="Saved adjustment evidence" style={{marginTop:18,overflowWrap:'anywhere'}}>
        <h3 ref={evidenceHeading} tabIndex={-1} style={{fontSize:14,scrollMarginTop:120}}>Adjustment {evidence.adjustment.number} · {evidence.adjustment.status} · {evidence.adjustment.currency}</h3>
        {report?.adjustments.find(row=>row.id===selectedId)?.status!==evidence.adjustment.status?<p>Saved status changed since the register was read. Reload the register to update its status.</p>:null}
        <p>{evidence.adjustment.periodName} · {evidence.adjustment.description} · Reason: {evidence.adjustment.reason}</p>
        <p style={{fontSize:12}}>Source: {evidence.adjustment.sourceType??'Not recorded'} · {evidence.adjustment.sourceId??'Not recorded'} · Reversal of: {evidence.adjustment.reversalOf??'Not applicable'} · Reference period: {evidence.adjustment.referencePeriodId??'Not supplied'}. Related corrections can belong to another period.</p>
        <p style={{fontSize:12}}>Saved line totals: exclusive {formatMoneyCentsExact(totals[0],currency)} · tax {formatMoneyCentsExact(totals[1],currency)} · inclusive {formatMoneyCentsExact(totals[2],currency)}. Posting and classification are separate from these amounts.</p>
        <FinanceAdjustmentLineEvidence key={detailKey} lines={evidence.lines} currency={evidence.adjustment.currency}/>
        <FinanceAdjustmentLifecycle events={evidence.events}/>
        <button type="button" onClick={closeEvidence} {...buttonProps('secondary','sm')}>Close adjustment evidence</button>
      </div>:null}
    </>}
  </section>;
}
